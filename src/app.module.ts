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
import { CacheModule } from '@nestjs/cache-manager';
import { TemporaryConversationsModule } from './temporary-conversations/temporary-conversations.module';
import { TemporaryRoomsModule } from './temporary-rooms/temporary-rooms.module';
import { SystemConfigModule } from './system-config/system-config.module';
import { MessagesModule } from './messages/messages.module';
import { RoomFavoritesModule } from './room-favorites/room-favorites.module';
import { ConversationFavoritesModule } from './conversation-favorites/conversation-favorites.module';
import { PollsModule } from './polls/polls.module';
import { databaseConfig } from './config/database.config';
import { redisConfig } from './config/redis.config';
import { DatabaseErrorInterceptor } from './common/interceptors/database-error.interceptor';

@Module({
  imports: [
    TypeOrmModule.forRoot(databaseConfig),
    ConfigModule.forRoot({ cache: true }),
    CacheModule.register(redisConfig), // 🔥 Redis cache global
    UsersModule,
    AuthModule,
    RolesModule,
    SocketModule,
    TemporaryConversationsModule,
    TemporaryRoomsModule,
    SystemConfigModule,
    MessagesModule,
    RoomFavoritesModule,
    ConversationFavoritesModule,
    PollsModule,
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
export class AppModule { }
