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
  synchronize: false,        // 🔥 clave
  timezone: 'Z',
  logging: false,

  extra: {
    connectionLimit: 15,
    waitForConnections: true,
    queueLimit: 50,
    acquireTimeout: 8000,
    connectTimeout: 10000,
    idleTimeout: 10000,
  },
};