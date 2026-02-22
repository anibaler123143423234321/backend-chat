import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TemporaryConversationsService } from 'src/02.-Services/temporary-conversations/temporary-conversations.service';
import { TemporaryConversationsController } from 'src/02.-Services/temporary-conversations/temporary-conversations.controller';
import { TemporaryConversation } from 'src/02.-Services/temporary-conversations/entities/temporary-conversation.entity';
import { Message } from 'src/02.-Services/messages/entities/message.entity';
import { User } from 'src/02.-Services/users/entities/user.entity'; //  Importar entidad User

@Module({
  imports: [TypeOrmModule.forFeature([TemporaryConversation, Message, User])], //  Agregar User
  controllers: [TemporaryConversationsController],
  providers: [TemporaryConversationsService],
  exports: [TemporaryConversationsService],
})
export class TemporaryConversationsModule { }
