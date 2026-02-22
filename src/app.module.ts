import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './02.-Services/users/users.module';
import { RolesModule } from './02.-Services/roles/roles.module';
import { SocketModule } from './03.-Socket/socket/socket.module';
import { ConfigModule } from '@nestjs/config';
import { TemporaryConversationsModule } from './02.-Services/temporary-conversations/temporary-conversations.module';
import { TemporaryRoomsModule } from './02.-Services/temporary-rooms/temporary-rooms.module';
import { SystemConfigModule } from './02.-Services/system-config/system-config.module';
import { MessagesModule } from './02.-Services/messages/messages.module';
import { RoomFavoritesModule } from './02.-Services/room-favorites/room-favorites.module';
import { ConversationFavoritesModule } from './02.-Services/conversation-favorites/conversation-favorites.module';
import { PollsModule } from './02.-Services/polls/polls.module';
import { RecentSearchesModule } from './02.-Services/recent-searches/recent-searches.module';
import { databaseConfig } from './01.-Infraestructura/config/database.config';
import { DatabaseErrorInterceptor } from './01.-Infraestructura/interceptors/database-error.interceptor';

@Module({
  imports: [
    TypeOrmModule.forRoot(databaseConfig),
    ConfigModule.forRoot({ cache: true }),
    UsersModule,
    RolesModule,
    SocketModule,
    TemporaryConversationsModule,
    TemporaryRoomsModule,
    SystemConfigModule,
    MessagesModule,
    RoomFavoritesModule,
    ConversationFavoritesModule,
    PollsModule,
    RecentSearchesModule,
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
