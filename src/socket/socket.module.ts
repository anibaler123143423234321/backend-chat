import { Module } from '@nestjs/common';
import { SocketGateway } from './socket.gateway';
import { TemporaryRoomsModule } from '../temporary-rooms/temporary-rooms.module';

@Module({
  imports: [TemporaryRoomsModule],
  providers: [SocketGateway],
})
export class SocketModule {}
