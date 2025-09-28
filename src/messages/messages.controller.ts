import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';

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
    // console.log(`✅ Marcando mensaje ${id} como leído por ${username}`);
    await this.messagesService.markAsRead(parseInt(id), username);
    return { success: true };
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
}
