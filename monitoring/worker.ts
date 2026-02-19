// src/worker.ts
import { workerData, parentPort, isMainThread, Worker } from 'worker_threads';
import * as http from 'http';
import * as os from 'os';
import * as perf_hooks from 'perf_hooks';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface HealthMetrics {
    timestamp: string;
    eventLoop: EventLoopMetrics;
    memory: MemoryMetrics;
    cpu: CpuMetrics;
    endpoints: EndpointHealth[];
    overall: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
}

interface EventLoopMetrics {
    lagMs: number;
    utilizationPercent: number;
    status: 'OK' | 'WARN' | 'CRITICAL';
}

interface MemoryMetrics {
    heapUsedMb: number;
    heapTotalMb: number;
    rssMb: number;
    externalMb: number;
    heapUsedPercent: number;
    status: 'OK' | 'WARN' | 'CRITICAL';
}

interface CpuMetrics {
    loadAvg1m: number;
    loadAvg5m: number;
    loadAvg15m: number;
    cpuCount: number;
    normalizedLoad: number;
    status: 'OK' | 'WARN' | 'CRITICAL';
}

interface EndpointHealth {
    name: string;
    url: string;
    statusCode: number | null;
    responseTimeMs: number | null;
    status: 'UP' | 'SLOW' | 'DOWN';
    error?: string;
}

// ─── Configuración ────────────────────────────────────────────────────────────

const CONFIG = {
    BASE_URL: process.env.HEALTH_BASE_URL || 'http://localhost:8747',
    CHECK_INTERVAL_MS: Number(process.env.HEALTH_CHECK_INTERVAL) || 15_000,
    METRICS_PORT: Number(process.env.METRICS_PORT) || 9100,
    THRESHOLDS: {
        eventLoop: { warnMs: 50, criticalMs: 200 },
        memory: { warnPercent: 85, criticalPercent: 95 }, // Ajustado para evitar alertas prematuras en workers pequeños
        cpu: { warnLoad: 0.8, criticalLoad: 0.95 },
        endpoint: { warnMs: 800, criticalMs: 2000 },
    },
    ENDPOINTS_TO_CHECK: [
        // Rutas públicas o que devuelven 200 OK sin auth
        { name: 'Docs (Swagger)', path: '/api/docs-json' },
        { name: 'Temporary Rooms', path: '/api/temporary-rooms/all' }, // Ajusta si requiere auth, o usa una known public route
        { name: 'System Config', path: '/api/system-config/message-expiration' }, // Suele ser publico o ligero
    ],
};

// ─── Event Loop Monitor ───────────────────────────────────────────────────────

class EventLoopMonitor {
    private lastCheck = Date.now();
    private lagHistory: number[] = [];
    private elu = perf_hooks.performance.eventLoopUtilization();

    measure(): EventLoopMetrics {
        const now = Date.now();
        const expectedInterval = 100;
        const actualInterval = now - this.lastCheck;
        const lagMs = Math.max(0, actualInterval - expectedInterval);

        this.lagHistory.push(lagMs);
        if (this.lagHistory.length > 10) this.lagHistory.shift();

        const avgLag = this.lagHistory.reduce((a, b) => a + b, 0) / this.lagHistory.length;

        // Event Loop Utilization (ELU)
        const newElu = perf_hooks.performance.eventLoopUtilization(this.elu);
        this.elu = perf_hooks.performance.eventLoopUtilization();
        const utilizationPercent = Math.round(newElu.utilization * 100);

        this.lastCheck = now;

        let status: EventLoopMetrics['status'] = 'OK';
        if (avgLag >= CONFIG.THRESHOLDS.eventLoop.criticalMs) status = 'CRITICAL';
        else if (avgLag >= CONFIG.THRESHOLDS.eventLoop.warnMs) status = 'WARN';

        return {
            lagMs: Math.round(avgLag),
            utilizationPercent,
            status,
        };
    }
}

// ─── Memory Monitor ───────────────────────────────────────────────────────────

function measureMemory(): MemoryMetrics {
    const mem = process.memoryUsage();
    const toMb = (bytes: number) => Math.round(bytes / 1024 / 1024);
    const heapUsedPercent = Math.round((mem.heapUsed / mem.heapTotal) * 100);

    let status: MemoryMetrics['status'] = 'OK';
    if (heapUsedPercent >= CONFIG.THRESHOLDS.memory.criticalPercent) status = 'CRITICAL';
    else if (heapUsedPercent >= CONFIG.THRESHOLDS.memory.warnPercent) status = 'WARN';

    return {
        heapUsedMb: toMb(mem.heapUsed),
        heapTotalMb: toMb(mem.heapTotal),
        rssMb: toMb(mem.rss),
        externalMb: toMb(mem.external),
        heapUsedPercent,
        status,
    };
}

// ─── CPU Monitor ─────────────────────────────────────────────────────────────

function measureCpu(): CpuMetrics {
    const [avg1, avg5, avg15] = os.loadavg();
    const cpuCount = os.cpus().length;
    const normalizedLoad = avg1 / cpuCount;

    let status: CpuMetrics['status'] = 'OK';
    if (normalizedLoad >= CONFIG.THRESHOLDS.cpu.criticalLoad) status = 'CRITICAL';
    else if (normalizedLoad >= CONFIG.THRESHOLDS.cpu.warnLoad) status = 'WARN';

    return {
        loadAvg1m: Math.round(avg1 * 100) / 100,
        loadAvg5m: Math.round(avg5 * 100) / 100,
        loadAvg15m: Math.round(avg15 * 100) / 100,
        cpuCount,
        normalizedLoad: Math.round(normalizedLoad * 100) / 100,
        status,
    };
}

// ─── Endpoint Health Checker ──────────────────────────────────────────────────

function checkEndpoint(
    name: string,
    url: string,
    timeoutMs = 3000,
): Promise<EndpointHealth> {
    return new Promise((resolve) => {
        const start = Date.now();

        const req = http.get(url, { timeout: timeoutMs }, (res) => {
            res.resume(); // consume response para liberar memoria
            const responseTimeMs = Date.now() - start;
            const statusCode = res.statusCode ?? 0;

            let status: EndpointHealth['status'] = 'UP';
            if (responseTimeMs >= CONFIG.THRESHOLDS.endpoint.criticalMs || statusCode >= 500) {
                status = 'DOWN';
            } else if (responseTimeMs >= CONFIG.THRESHOLDS.endpoint.warnMs || statusCode >= 400) {
                status = 'SLOW';
            }

            resolve({ name, url, statusCode, responseTimeMs, status });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({
                name,
                url,
                statusCode: null,
                responseTimeMs: timeoutMs,
                status: 'DOWN',
                error: 'TIMEOUT',
            });
        });

        req.on('error', (err) => {
            resolve({
                name,
                url,
                statusCode: null,
                responseTimeMs: Date.now() - start,
                status: 'DOWN',
                error: err.message,
            });
        });
    });
}

async function checkAllEndpoints(): Promise<EndpointHealth[]> {
    const checks = CONFIG.ENDPOINTS_TO_CHECK.map((ep) =>
        checkEndpoint(ep.name, `${CONFIG.BASE_URL}${ep.path}`),
    );
    return Promise.all(checks);
}

// ─── Determine Overall Health ─────────────────────────────────────────────────

function determineOverallHealth(metrics: Omit<HealthMetrics, 'overall' | 'timestamp'>): HealthMetrics['overall'] {
    const statuses = [
        metrics.eventLoop.status,
        metrics.memory.status,
        metrics.cpu.status,
    ];
    const endpointStatuses = metrics.endpoints.map((e) => e.status);

    if (
        statuses.includes('CRITICAL') ||
        endpointStatuses.filter((s) => s === 'DOWN').length > 1
    ) return 'CRITICAL';

    if (
        statuses.includes('WARN') ||
        endpointStatuses.includes('DOWN') ||
        endpointStatuses.filter((s) => s === 'SLOW').length >= 2
    ) return 'DEGRADED';

    return 'HEALTHY';
}

// ─── Logger con colores ───────────────────────────────────────────────────────

const COLOR = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
    bold: '\x1b[1m',
};

function colorStatus(status: string): string {
    if (status === 'CRITICAL' || status === 'DOWN') return `${COLOR.red}${status}${COLOR.reset}`;
    if (status === 'WARN' || status === 'DEGRADED' || status === 'SLOW') return `${COLOR.yellow}${status}${COLOR.reset}`;
    return `${COLOR.green}${status}${COLOR.reset}`;
}

function logMetrics(metrics: HealthMetrics): void {
    const ts = new Date(metrics.timestamp).toLocaleTimeString('es-PE');
    const overall = colorStatus(metrics.overall);

    console.log(`\n${COLOR.bold}${COLOR.cyan}[WORKER MONITOR]${COLOR.reset} ${ts} — Estado: ${overall}`);
    console.log(
        `${COLOR.gray}  EventLoop${COLOR.reset}  lag: ${metrics.eventLoop.lagMs}ms | ELU: ${metrics.eventLoop.utilizationPercent}% | ${colorStatus(metrics.eventLoop.status)}`,
    );
    console.log(
        `${COLOR.gray}  Memory   ${COLOR.reset}  heap: ${metrics.memory.heapUsedMb}/${metrics.memory.heapTotalMb}MB (${metrics.memory.heapUsedPercent}%) | RSS: ${metrics.memory.rssMb}MB | ${colorStatus(metrics.memory.status)}`,
    );
    console.log(
        `${COLOR.gray}  CPU      ${COLOR.reset}  load: ${metrics.cpu.loadAvg1m} / ${metrics.cpu.loadAvg5m} / ${metrics.cpu.loadAvg15m} (norm: ${metrics.cpu.normalizedLoad}) | ${colorStatus(metrics.cpu.status)}`,
    );
    console.log(`${COLOR.gray}  Endpoints${COLOR.reset}`);
    for (const ep of metrics.endpoints) {
        const rt = ep.responseTimeMs !== null ? `${ep.responseTimeMs}ms` : 'N/A';
        const code = ep.statusCode ?? 'ERR';
        console.log(
            `    ${colorStatus(ep.status)} ${ep.name.padEnd(20)} ${String(code).padStart(3)} ${rt.padStart(6)}${ep.error ? ` (${ep.error})` : ''}`,
        );
    }
}

// ─── Metrics HTTP Server (para Prometheus / dashboards externos) ──────────────

let latestMetrics: HealthMetrics | null = null;

function startMetricsServer(): void {
    // ─── PM2 CLUSTER MODE SUPPORT ─────────────────────────────────────────────
    // Solo la instancia 0 (o dev sin cluster) levanta el servidor de métricas
    // para evitar conflictos de puerto (EADDRINUSE).
    const instanceId = process.env.NODE_APP_INSTANCE;
    const isMainInstance = !instanceId || instanceId === '0';

    if (!isMainInstance) {
        // console.log(`[WORKER MONITOR] Instancia PM2 #${instanceId}: Modo pasivo (sin puerto metrics)`);
        return;
    }
    // ──────────────────────────────────────────────────────────────────────────

    const server = http.createServer((req, res) => {
        if (req.url === '/metrics' && req.method === 'GET') {
            if (!latestMetrics) {
                res.writeHead(503);
                res.end('Not ready');
                return;
            }
            // Formato Prometheus-compatible
            const m = latestMetrics;
            const lines = [
                `# HELP backend_event_loop_lag_ms Event loop lag in milliseconds`,
                `backend_event_loop_lag_ms ${m.eventLoop.lagMs}`,
                `# HELP backend_event_loop_utilization Event loop utilization percent`,
                `backend_event_loop_utilization ${m.eventLoop.utilizationPercent}`,
                `# HELP backend_heap_used_mb Heap used in MB`,
                `backend_heap_used_mb ${m.memory.heapUsedMb}`,
                `# HELP backend_heap_used_percent Heap used percent`,
                `backend_heap_used_percent ${m.memory.heapUsedPercent}`,
                `# HELP backend_rss_mb RSS memory in MB`,
                `backend_rss_mb ${m.memory.rssMb}`,
                `# HELP backend_cpu_load_1m CPU load average 1m`,
                `backend_cpu_load_1m ${m.cpu.loadAvg1m}`,
                `# HELP backend_cpu_normalized_load Normalized CPU load`,
                `backend_cpu_normalized_load ${m.cpu.normalizedLoad}`,
                `# HELP backend_overall_health 0=HEALTHY 1=DEGRADED 2=CRITICAL`,
                `backend_overall_health ${m.overall === 'HEALTHY' ? 0 : m.overall === 'DEGRADED' ? 1 : 2}`,
                ...m.endpoints.map((ep) =>
                    `backend_endpoint_up{name="${ep.name}"} ${ep.status === 'UP' ? 1 : ep.status === 'SLOW' ? 0.5 : 0}`,
                ),
                ...m.endpoints.map((ep) =>
                    `backend_endpoint_response_ms{name="${ep.name}"} ${ep.responseTimeMs ?? -1}`,
                ),
            ];
            res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
            res.end(lines.join('\n'));

        } else if (req.url === '/health' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(latestMetrics, null, 2));

        } else {
            res.writeHead(404);
            res.end('Not found');
        }
    });

    server.listen(CONFIG.METRICS_PORT, '0.0.0.0', () => {
        console.log(
            `${COLOR.cyan}[WORKER MONITOR]${COLOR.reset} Metrics server escuchando en :${CONFIG.METRICS_PORT}`,
        );
        console.log(
            `  → JSON:       http://localhost:${CONFIG.METRICS_PORT}/health`,
        );
        console.log(
            `  → Prometheus: http://localhost:${CONFIG.METRICS_PORT}/metrics`,
        );
    });
}

// ─── Ciclo Principal del Worker ───────────────────────────────────────────────

const eventLoopMonitor = new EventLoopMonitor();

async function runHealthCheck(): Promise<void> {
    const [eventLoop, memory, cpu, endpoints] = await Promise.all([
        Promise.resolve(eventLoopMonitor.measure()),
        Promise.resolve(measureMemory()),
        Promise.resolve(measureCpu()),
        checkAllEndpoints(),
    ]);

    const partial = { eventLoop, memory, cpu, endpoints };
    const overall = determineOverallHealth(partial);

    latestMetrics = {
        timestamp: new Date().toISOString(),
        ...partial,
        overall,
    };

    logMetrics(latestMetrics);

    // Si está en worker_thread, notifica al hilo principal
    if (!isMainThread && parentPort) {
        parentPort.postMessage({ type: 'METRICS', payload: latestMetrics });
    }
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

async function startWorker(): Promise<void> {
    console.log(`${COLOR.bold}${COLOR.cyan}[WORKER MONITOR]${COLOR.reset} Iniciando monitor de salud...`);
    console.log(`  Intervalo de chequeo: ${CONFIG.CHECK_INTERVAL_MS / 1000}s`);
    console.log(`  Base URL monitoreada: ${CONFIG.BASE_URL}`);

    startMetricsServer();

    // Primera medición inmediata
    await runHealthCheck();

    // Ciclo de monitoreo usando setInterval
    // El lag se mide correctamente porque este worker corre en su propio hilo
    setInterval(() => {
        runHealthCheck().catch((err) =>
            console.error(`${COLOR.red}[WORKER MONITOR] Error en health check:${COLOR.reset}`, err),
        );
    }, CONFIG.CHECK_INTERVAL_MS);

    // Pequeño loop para medir event loop lag con precisión
    setInterval(() => {
        eventLoopMonitor.measure();
    }, 100);
}

// ─── Modo: Worker Thread o Proceso Independiente ─────────────────────────────

if (isMainThread) {
    // Ejecutado directamente: node dist/worker.js
    startWorker().catch(console.error);
} else {
    // Ejecutado como worker_thread desde otro módulo
    if (parentPort) {
        parentPort.on('message', (msg) => {
            if (msg === 'start') startWorker().catch(console.error);
            if (msg === 'getMetrics' && parentPort) {
                parentPort.postMessage({ type: 'METRICS', payload: latestMetrics });
            }
        });
        // Auto-start si tiene workerData
        if (workerData?.autoStart) {
            startWorker().catch(console.error);
        }
    }
}