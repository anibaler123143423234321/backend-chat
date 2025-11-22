import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SocketGateway } from './socket.gateway';
import { TemporaryRoomsModule } from '../temporary-rooms/temporary-rooms.module';
import { MessagesModule } from '../messages/messages.module';
import { TemporaryConversationsModule } from '../temporary-conversations/temporary-conversations.module';
import { User } from '../users/entities/user.entity';
import { PollsModule } from '../polls/polls.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    TemporaryRoomsModule,
    forwardRef(() => MessagesModule),
    TemporaryConversationsModule,
    PollsModule,
  ],
  providers: [SocketGateway],
  exports: [SocketGateway],
})
export class SocketModule { }
