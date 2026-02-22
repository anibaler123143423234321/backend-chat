import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessagesService } from 'src/02.-Services/messages/messages.service';
import { MessagesController } from 'src/02.-Services/messages/messages.controller';
import { Message } from 'src/02.-Services/messages/entities/message.entity';
import { TemporaryConversation } from 'src/02.-Services/temporary-conversations/entities/temporary-conversation.entity';
import { TemporaryRoom } from 'src/02.-Services/temporary-rooms/entities/temporary-room.entity';
import { User } from 'src/02.-Services/users/entities/user.entity';
import { SocketModule } from 'src/03.-Socket/socket/socket.module';

import { MessageAttachment } from 'src/02.-Services/messages/entities/message-attachment.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Message,
      TemporaryRoom,
      TemporaryConversation,
      User,
      MessageAttachment,
    ]),
    forwardRef(() => SocketModule),
  ],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule { }
