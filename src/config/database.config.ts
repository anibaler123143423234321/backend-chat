import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const databaseConfig: TypeOrmModuleOptions = {
  type: 'mysql',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,

  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: false,
  timezone: 'Z',
  logging: false,

  // 🔥 Retry automático si MySQL reinicia o cierra conexión
  retryAttempts: 5,
  retryDelay: 3000,

  extra: {
    // Pool: 20 × 4 workers PM2 = 80 conexiones (MySQL tiene 3000)
    connectionLimit: 20,
    waitForConnections: true,
    queueLimit: 100,

    // Timeouts
    connectTimeout: 10000,
    acquireTimeout: 10000,

    // 🔥 CLAVE: Evita ECONNRESET manteniendo conexiones TCP vivas
    enableKeepAlive: true,
    keepAliveInitialDelay: 30000, // Ping cada 30s
  },
};