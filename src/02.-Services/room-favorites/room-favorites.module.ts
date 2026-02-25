import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoomFavorite } from 'src/02.-Services/room-favorites/entities/room-favorite.entity';
import { Message } from 'src/02.-Services/messages/entities/message.entity';
import { TemporaryRoom } from 'src/02.-Services/temporary-rooms/entities/temporary-room.entity';
import { ConversationFavoritesModule } from 'src/02.-Services/conversation-favorites/conversation-favorites.module';
import { MessagesModule } from 'src/02.-Services/messages/messages.module';
import { RoomFavoritesService } from 'src/02.-Services/room-favorites/room-favorites.service';
import { RoomFavoritesController } from 'src/02.-Services/room-favorites/room-favorites.controller';
import { SocketModule } from 'src/03.-Socket/socket/socket.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RoomFavorite, Message, TemporaryRoom]),
    ConversationFavoritesModule,
    forwardRef(() => MessagesModule),
    forwardRef(() => SocketModule),
  ],
  controllers: [RoomFavoritesController],
  providers: [RoomFavoritesService],
  exports: [RoomFavoritesService],
})
export class RoomFavoritesModule { }

