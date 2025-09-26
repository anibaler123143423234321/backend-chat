import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TemporaryConversationsService } from './temporary-conversations.service';
import { TemporaryConversationsController } from './temporary-conversations.controller';
import { TemporaryConversation } from './entities/temporary-conversation.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([TemporaryConversation]), AuthModule],
  controllers: [TemporaryConversationsController],
  providers: [TemporaryConversationsService],
  exports: [TemporaryConversationsService],
})
export class TemporaryConversationsModule {}
