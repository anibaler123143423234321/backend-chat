import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TemporaryRoomsService } from './temporary-rooms.service';
import { TemporaryRoomsController } from './temporary-rooms.controller';
import { TemporaryRoom } from './entities/temporary-room.entity';
import { User } from '../users/entities/user.entity';
import { Message } from '../messages/entities/message.entity';
import { AuthModule } from '../auth/auth.module';
import { RoomFavoritesModule } from '../room-favorites/room-favorites.module';

@Module({
  imports: [TypeOrmModule.forFeature([TemporaryRoom, User, Message]), AuthModule, RoomFavoritesModule],
  controllers: [TemporaryRoomsController],
  providers: [TemporaryRoomsService],
  exports: [TemporaryRoomsService],
})
export class TemporaryRoomsModule {}
