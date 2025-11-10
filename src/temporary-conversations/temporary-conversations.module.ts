import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TemporaryConversationsService } from './temporary-conversations.service';
import { TemporaryConversationsController } from './temporary-conversations.controller';
import { TemporaryConversation } from './entities/temporary-conversation.entity';
import { Message } from '../messages/entities/message.entity';
import { User } from '../users/entities/user.entity'; // 🔥 Importar entidad User
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([TemporaryConversation, Message, User]), AuthModule], // 🔥 Agregar User
  controllers: [TemporaryConversationsController],
  providers: [TemporaryConversationsService],
  exports: [TemporaryConversationsService],
})
export class TemporaryConversationsModule {}
