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
    connectionLimit: 10,
    acquireTimeout: 60000,
    timeout: 60000,
    reconnect: true,
    // Configuraciones de MySQL para conexiones más estables
    charset: 'utf8mb4',
    // Configuraciones de pool de conexiones
    pool: {
      min: 2,
      max: 10,
      acquireTimeoutMillis: 60000,
      createTimeoutMillis: 30000,
      destroyTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 200,
    },
    // Configuraciones de reconexión
    retryAttempts: 3,
    retryDelay: 3000,
  },
};
