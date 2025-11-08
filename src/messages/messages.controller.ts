import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Patch,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { MarkReadDto } from './dto/mark-read.dto';

@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  async create(@Body() createMessageDto: CreateMessageDto) {
    // console.log('💬 Creando mensaje:', createMessageDto);
    return await this.messagesService.create(createMessageDto);
  }

  @Get('room/:roomCode')
  async findByRoom(
    @Param('roomCode') roomCode: string,
    @Query('limit') limit: string = '50',
    @Query('offset') offset: string = '0',
  ) {
    // console.log(`📋 Obteniendo mensajes de la sala: ${roomCode}`);
    return await this.messagesService.findByRoom(
      roomCode,
      parseInt(limit),
      parseInt(offset),
    );
  }

  @Get('user/:from/:to')
  async findByUser(
    @Param('from') from: string,
    @Param('to') to: string,
    @Query('limit') limit: string = '50',
    @Query('offset') offset: string = '0',
  ) {
    // console.log(`👤 Obteniendo mensajes entre ${from} y ${to}`);
    return await this.messagesService.findByUser(
      from,
      to,
      parseInt(limit),
      parseInt(offset),
    );
  }

  @Get('recent')
  async findRecent(@Query('limit') limit: string = '20') {
    // console.log(`🕒 Obteniendo mensajes recientes`);
    return await this.messagesService.findRecentMessages(parseInt(limit));
  }

  @Put(':id/read')
  async markAsRead(
    @Param('id') id: string,
    @Body('username') username: string,
  ) {
    console.log(`✅ Marcando mensaje ${id} como leído por ${username}`);
    const message = await this.messagesService.markAsRead(parseInt(id), username);
    return { success: !!message, message };
  }

  // Marcar múltiples mensajes como leídos
  @Patch('mark-read')
  async markMultipleAsRead(@Body() markReadDto: MarkReadDto) {
    console.log(`✅ Marcando ${markReadDto.messageIds?.length || 0} mensajes como leídos por ${markReadDto.username}`);

    if (markReadDto.messageIds && markReadDto.messageIds.length > 0) {
      const messages = await this.messagesService.markMultipleAsRead(
        markReadDto.messageIds,
        markReadDto.username,
      );
      return { success: true, messagesUpdated: messages.length, messages };
    }

    return { success: false, message: 'No message IDs provided' };
  }

  // Marcar toda una conversación como leída
  @Patch('mark-conversation-read')
  async markConversationAsRead(
    @Body('from') from: string,
    @Body('to') to: string,
  ) {
    console.log(`✅ Marcando conversación de ${from} a ${to} como leída`);
    const messages = await this.messagesService.markConversationAsRead(from, to);
    return { success: true, messagesUpdated: messages.length, messages };
  }

  @Put(':id')
  async editMessage(
    @Param('id') id: string,
    @Body('username') username: string,
    @Body('message') message: string,
  ) {
    // console.log(`✏️ Editando mensaje ${id} por ${username}`);
    const edited = await this.messagesService.editMessage(
      parseInt(id),
      username,
      message,
    );
    return { success: !!edited, message: edited };
  }

  @Delete(':id')
  async deleteMessage(
    @Param('id') id: string,
    @Body('username') username: string,
  ) {
    // console.log(`🗑️ Eliminando mensaje ${id} por ${username}`);
    const deleted = await this.messagesService.deleteMessage(
      parseInt(id),
      username,
    );
    return { success: deleted };
  }

  @Get('stats/:roomCode?')
  async getStats(@Param('roomCode') roomCode?: string) {
    // console.log(`📊 Obteniendo estadísticas de mensajes`);
    return await this.messagesService.getMessageStats(roomCode);
  }

  @Get('search/:username')
  async searchMessages(
    @Param('username') username: string,
    @Query('q') searchTerm: string,
    @Query('limit') limit: string = '50',
  ) {
    console.log(`🔍 Buscando mensajes para ${username} con término: "${searchTerm}"`);
    return await this.messagesService.searchMessages(
      username,
      searchTerm,
      parseInt(limit),
    );
  }

  @Get('thread/:threadId')
  async findThreadMessages(
    @Param('threadId') threadId: string,
    @Query('limit') limit: string = '50',
    @Query('offset') offset: string = '0',
  ) {
    console.log(`🧵 Obteniendo mensajes del hilo: ${threadId}`);
    return await this.messagesService.findThreadMessages(
      parseInt(threadId),
      parseInt(limit),
      parseInt(offset),
    );
  }

  @Patch(':id/increment-thread')
  async incrementThreadCount(@Param('id') id: string) {
    await this.messagesService.incrementThreadCount(parseInt(id));
    return { success: true };
  }
}
