import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoomFavorite } from './entities/room-favorite.entity';
import { Message } from '../messages/entities/message.entity';
import { ConversationFavoritesModule } from '../conversation-favorites/conversation-favorites.module';
import { RoomFavoritesService } from './room-favorites.service';
import { RoomFavoritesController } from './room-favorites.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([RoomFavorite, Message]),
    ConversationFavoritesModule,
  ],
  controllers: [RoomFavoritesController],
  providers: [RoomFavoritesService],
  exports: [RoomFavoritesService],
})
export class RoomFavoritesModule { }

