import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SocketGateway } from './socket.gateway';
import { TemporaryRoomsModule } from '../temporary-rooms/temporary-rooms.module';
import { MessagesModule } from '../messages/messages.module';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    TemporaryRoomsModule,
    MessagesModule
  ],
  providers: [SocketGateway],
})
export class SocketModule {}
