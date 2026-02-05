import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { Message } from './entities/message.entity';
import { TemporaryConversation } from '../temporary-conversations/entities/temporary-conversation.entity';
import { TemporaryRoom } from '../temporary-rooms/entities/temporary-room.entity';
import { User } from '../users/entities/user.entity';
import { SocketModule } from '../socket/socket.module';

import { MessageAttachment } from './entities/message-attachment.entity';

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
