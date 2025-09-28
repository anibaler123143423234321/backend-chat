import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { RolesModule } from './roles/roles.module';
import { SocketModule } from './socket/socket.module';
import { ConfigModule } from '@nestjs/config';
import { TemporaryConversationsModule } from './temporary-conversations/temporary-conversations.module';
import { TemporaryRoomsModule } from './temporary-rooms/temporary-rooms.module';
import { SystemConfigModule } from './system-config/system-config.module';
import { MessagesModule } from './messages/messages.module';
import { databaseConfig } from './config/database.config';
import { DatabaseErrorInterceptor } from './common/interceptors/database-error.interceptor';

@Module({
  imports: [
    TypeOrmModule.forRoot(databaseConfig),
    ConfigModule.forRoot({ cache: true }),
    UsersModule,
    AuthModule,
    RolesModule,
    SocketModule,
    TemporaryConversationsModule,
    TemporaryRoomsModule,
    SystemConfigModule,
    MessagesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: DatabaseErrorInterceptor,
    },
  ],
})
export class AppModule {}
