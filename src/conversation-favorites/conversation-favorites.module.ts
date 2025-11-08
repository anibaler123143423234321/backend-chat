import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationFavorite } from './entities/conversation-favorite.entity';
import { ConversationFavoritesService } from './conversation-favorites.service';
import { ConversationFavoritesController } from './conversation-favorites.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ConversationFavorite])],
  controllers: [ConversationFavoritesController],
  providers: [ConversationFavoritesService],
  exports: [ConversationFavoritesService],
})
export class ConversationFavoritesModule {}

