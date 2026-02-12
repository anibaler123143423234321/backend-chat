import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TemporaryRoomsService } from './temporary-rooms.service';
import { TemporaryRoomsController } from './temporary-rooms.controller';
import { TemporaryRoom } from './entities/temporary-room.entity';
import { User } from '../users/entities/user.entity';
import { Message } from '../messages/entities/message.entity';
import { RoomFavoritesModule } from '../room-favorites/room-favorites.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TemporaryRoom, User, Message]),
    RoomFavoritesModule,
    forwardRef(() => MessagesModule),
  ],
  controllers: [TemporaryRoomsController],
  providers: [TemporaryRoomsService],
  exports: [TemporaryRoomsService],
})
export class TemporaryRoomsModule { }
