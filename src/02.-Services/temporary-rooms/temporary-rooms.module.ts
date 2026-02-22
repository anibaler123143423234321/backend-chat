import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TemporaryRoomsService } from 'src/02.-Services/temporary-rooms/temporary-rooms.service';
import { TemporaryRoomsController } from 'src/02.-Services/temporary-rooms/temporary-rooms.controller';
import { TemporaryRoom } from 'src/02.-Services/temporary-rooms/entities/temporary-room.entity';
import { User } from 'src/02.-Services/users/entities/user.entity';
import { Message } from 'src/02.-Services/messages/entities/message.entity';
import { RoomFavoritesModule } from 'src/02.-Services/room-favorites/room-favorites.module';
import { MessagesModule } from 'src/02.-Services/messages/messages.module';

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
