import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const databaseConfig: TypeOrmModuleOptions = {
  type: 'mysql',
  //host: process.env.DB_HOST || 'localhost',
  host: process.env.DB_HOST || '198.46.186.2',
  port: parseInt(process.env.DB_PORT) || 3306,
  username: process.env.DB_USERNAME || 'usuarioCrm2',
  password: process.env.DB_PASSWORD || 'Midas*2025%',
  database: process.env.DB_DATABASE || 'chat_midas',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: true, // Forzar sincronización para crear tablas
  timezone: 'America/Lima',
  logging: false, // Deshabilitar logging para reducir ruido
  extra: {
    createDatabaseIfNotExist: true,
    // Configuraciones para manejar mejor los errores de conexión
    connectionLimit: 15, // Reducido de 20 a 15 - WebSockets optimizados requieren menos conexiones
    acquireTimeout: 60000, // Reducido de 120s a 60s - timeout más agresivo
    timeout: 120000, // Mantenido en 2 minutos
    connectTimeout: 60000, // 1 minuto para conectar
    // Configuraciones de MySQL para conexiones más estables
    charset: 'utf8mb4',
    // Configuraciones de pool de conexiones mejoradas
    pool: {
      min: 3, // Reducido de 5 a 3
      max: 15, // Reducido de 20 a 15
      acquireTimeoutMillis: 60000, // Reducido de 120s a 60s
      createTimeoutMillis: 60000, // 1 minuto
      destroyTimeoutMillis: 10000, // 10 segundos
      idleTimeoutMillis: 300000, // 5 minutos (reducido de 10 minutos)
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 500, // Aumentado de 200 a 500ms
    },
    // Configuraciones de reconexión mejoradas
    retryAttempts: 5, // Aumentado de 3 a 5
    retryDelay: 5000, // Aumentado de 3 a 5 segundos
    // Configuraciones adicionales de MySQL
    enableKeepAlive: true, // Mantener conexiones vivas
    keepAliveInitialDelay: 10000, // 10 segundos
    // Configuraciones para evitar timeouts
    waitForConnections: true,
    queueLimit: 0, // Sin límite de cola
    // Configuraciones de paquetes grandes (para archivos multimedia)
    maxAllowedPacket: 67108864, // 64MB (aumentado para archivos grandes)
  },
};
