import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const databaseConfig: TypeOrmModuleOptions = {
  type: 'mysql',
  host: process.env.DB_HOST || '198.46.186.2',
  port: parseInt(process.env.DB_PORT) || 3306,
  username: process.env.DB_USERNAME || 'usuarioCrm2',
  password: process.env.DB_PASSWORD || 'Midas*2025%',
  database: process.env.DB_DATABASE || 'chat_midas',

  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: false,
  timezone: 'Z',
  logging: false,

  extra: {
    connectionLimit: 5,
    waitForConnections: true,
    queueLimit: 0,
    acquireTimeout: 15000,
    enableKeepAlive: false,
    keepAliveInitialDelay: 10000,
  },
};