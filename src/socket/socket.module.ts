import { Module } from '@nestjs/common';
import { SocketGateway } from './socket.gateway';
import { TemporaryRoomsModule } from '../temporary-rooms/temporary-rooms.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [TemporaryRoomsModule, MessagesModule],
  providers: [SocketGateway],
})
export class SocketModule {}
