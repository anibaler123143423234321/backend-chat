import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationFavorite } from 'src/02.-Services/conversation-favorites/entities/conversation-favorite.entity';
import { ConversationFavoritesService } from 'src/02.-Services/conversation-favorites/conversation-favorites.service';
import { ConversationFavoritesController } from 'src/02.-Services/conversation-favorites/conversation-favorites.controller';
import { Message } from 'src/02.-Services/messages/entities/message.entity';
import { User } from 'src/02.-Services/users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ConversationFavorite, Message, User])],
  controllers: [ConversationFavoritesController],
  providers: [ConversationFavoritesService],
  exports: [ConversationFavoritesService],
})
export class ConversationFavoritesModule { }

