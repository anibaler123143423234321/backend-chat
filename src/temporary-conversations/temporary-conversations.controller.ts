import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Request,
} from '@nestjs/common';
import { TemporaryConversationsService } from './temporary-conversations.service';
import { CreateTemporaryConversationDto } from './dto/create-temporary-conversation.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('temporary-conversations')
@UseGuards(JwtAuthGuard)
export class TemporaryConversationsController {
  constructor(
    private readonly temporaryConversationsService: TemporaryConversationsService,
  ) {}

  @Post()
  create(@Body() createDto: CreateTemporaryConversationDto, @Request() req) {
    return this.temporaryConversationsService.create(createDto, req.user.id);
  }

  @Get()
  findAll() {
    return this.temporaryConversationsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.temporaryConversationsService.findOne(+id);
  }

  @Post('join/:linkId')
  joinConversation(@Param('linkId') linkId: string, @Request() req) {
    return this.temporaryConversationsService.joinConversation(
      linkId,
      req.user.username,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.temporaryConversationsService.remove(+id, req.user.id);
  }
}
