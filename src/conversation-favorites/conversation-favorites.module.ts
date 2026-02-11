import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationFavorite } from './entities/conversation-favorite.entity';
import { ConversationFavoritesService } from './conversation-favorites.service';
import { ConversationFavoritesController } from './conversation-favorites.controller';
import { Message } from '../messages/entities/message.entity';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ConversationFavorite, Message, User])],
  controllers: [ConversationFavoritesController],
  providers: [ConversationFavoritesService],
  exports: [ConversationFavoritesService],
})
export class ConversationFavoritesModule { }

