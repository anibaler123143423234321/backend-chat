import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const databaseConfig: TypeOrmModuleOptions = {
  type: 'mysql',
  host: process.env.DB_HOST,
  port: 3306,
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,

  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: false,        // 🔥 clave
  timezone: 'Z',
  logging: false,

  extra: {
    connectionLimit: 12,
    waitForConnections: true,
    queueLimit: 50,
    acquireTimeout: 8000,
    connectTimeout: 10000,
    idleTimeout: 10000,
  },
};