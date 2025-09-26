import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const databaseConfig: TypeOrmModuleOptions = {
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  username: process.env.DB_USERNAME || 'chat_user',
  password: process.env.DB_PASSWORD || 'chat_password',
  database: process.env.DB_DATABASE || 'chat_db',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: true, // Forzar sincronización para crear tablas
  timezone: 'America/Lima',
  extra: {
    createDatabaseIfNotExist: true,
  },
};
