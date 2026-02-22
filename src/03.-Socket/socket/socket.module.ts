import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SocketGateway } from './socket.gateway';
import { TemporaryRoomsModule } from 'src/02.-Services/temporary-rooms/temporary-rooms.module';
import { MessagesModule } from 'src/02.-Services/messages/messages.module';
import { TemporaryConversationsModule } from 'src/02.-Services/temporary-conversations/temporary-conversations.module';
import { PollsModule } from 'src/02.-Services/polls/polls.module';
import { RoomFavoritesModule } from 'src/02.-Services/room-favorites/room-favorites.module';
import { ConversationFavoritesModule } from 'src/02.-Services/conversation-favorites/conversation-favorites.module';
import { User } from 'src/02.-Services/users/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    TemporaryRoomsModule,
    forwardRef(() => MessagesModule),
    TemporaryConversationsModule,
    PollsModule,
    RoomFavoritesModule,
    ConversationFavoritesModule,
  ],
  providers: [SocketGateway],
  exports: [SocketGateway],
})
export class SocketModule { }
