import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const databaseConfig: TypeOrmModuleOptions = {
  type: 'mysql',
  host: process.env.DB_HOST || '198.46.186.2',
  port: parseInt(process.env.DB_PORT) || 3306,
  username: process.env.DB_USERNAME || 'usuarioCrm2',
  password: process.env.DB_PASSWORD || 'Midas*2025%',
  database: process.env.DB_DATABASE || 'chat_midas',

  entities: [__dirname + '/../**/*.entity{.ts,.js}'],

  synchronize: true,

  // NUNCA uses America/Lima (no lo soporta)
  timezone: 'Z',

  logging: false,

  extra: {
    //  OPTIMIZADO para 200+ usuarios concurrentes
    connectionLimit: 10, // REDUCIDO para Cluster Mode (10 x N_CORES < Max_MySQL)
    queueLimit: 0, // Sin límite de cola (espera infinita si no hay conexiones)
    acquireTimeout: 30000, // 30 segundos máximo para obtener conexión
    charset: 'utf8mb4',
    waitForConnections: true,
    enableKeepAlive: true, // Mantiene conexiones activas
    keepAliveInitialDelay: 5000, // Ping cada 5 segundos
  },
};