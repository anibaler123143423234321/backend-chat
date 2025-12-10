import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoomFavorite } from './entities/room-favorite.entity';
import { Message } from '../messages/entities/message.entity';
import { RoomFavoritesService } from './room-favorites.service';
import { RoomFavoritesController } from './room-favorites.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RoomFavorite, Message])],
  controllers: [RoomFavoritesController],
  providers: [RoomFavoritesService],
  exports: [RoomFavoritesService],
})
export class RoomFavoritesModule { }

