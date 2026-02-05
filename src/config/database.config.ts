import { TypeOrmModuleOptions } from '@nestjs/typeorm';

// 📊 CONFIGURACIÓN OPTIMIZADA PARA 300 USUARIOS CONCURRENTES
// Fórmula: connectionLimit = (conexiones_deseadas / workers_pm2)
// 160 conexiones totales / 8 workers = 20 por worker
export const databaseConfig: TypeOrmModuleOptions = {
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  username: process.env.DB_USERNAME || 'usuarioCrm2',
  password: process.env.DB_PASSWORD || 'Midas*2025%',
  database: process.env.DB_DATABASE || 'chat_midas',

  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: false,
  timezone: 'Z',
  logging: false,

  extra: {
    // 🚀 POOL OPTIMIZADO PARA 300 USUARIOS (8 workers PM2)
    connectionLimit: 20,            // 20 conexiones por worker = 160 total
    waitForConnections: true,
    queueLimit: 500,                // Cola más grande para picos de tráfico
    acquireTimeout: 60000,          // 60s para adquirir conexión (evita timeouts)
    connectTimeout: 30000,          // 30s para conectar
    idleTimeout: 60000,             // 60s antes de cerrar conexiones inactivas
    enableKeepAlive: true,          // Mantener conexiones vivas
    keepAliveInitialDelay: 30000,   // Ping cada 30s para evitar desconexiones
  },
};