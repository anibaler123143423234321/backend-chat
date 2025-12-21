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
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { User } from '../users/entities/user.entity';

@Controller('messages')
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) { }

  @Post()
  async create(@Body() createMessageDto: CreateMessageDto) {
    // Obtener senderRole y senderNumeroAgente de la BD si no vienen en el DTO
    if (createMessageDto.from && (!createMessageDto.senderRole || !createMessageDto.senderNumeroAgente)) {
      try {
        const dbUser = await this.userRepository.findOne({
          where: { username: createMessageDto.from },
        });

        if (dbUser) {
          if (!createMessageDto.senderRole) {
            createMessageDto.senderRole = dbUser.role;
          }
          if (!createMessageDto.senderNumeroAgente) {
            createMessageDto.senderNumeroAgente = dbUser.numeroAgente;
          }
          // console.log(
          //   `Controller - Info del remitente de BD: role=${createMessageDto.senderRole}, numeroAgente=${createMessageDto.senderNumeroAgente}`,
          // );
        }
      } catch (error) {
        console.error(`Controller - Error al buscar usuario en BD:`, error);
      }
    }

    const savedMessage = await this.messagesService.create(createMessageDto);

    return savedMessage;
  }
  async findByRoom(
    @Param('roomCode') roomCode: string,
    @Query('limit') limit: string = '20',
    @Query('offset') offset: string = '0',
  ) {
    // console.log(`ðŸ“‹ Obteniendo mensajes de la sala: ${roomCode}`);
    return await this.messagesService.findByRoom(
      roomCode,
      parseInt(limit),
      parseInt(offset),
    );
  }

  @Get('room/:roomCode/by-id')
  async findByRoomOrderedById(
    @Param('roomCode') roomCode: string,
    @Query('limit') limit: string = '20',
    @Query('offset') offset: string = '0',
  ) {
    return await this.messagesService.findByRoomOrderedById(
      roomCode,
      parseInt(limit),
      parseInt(offset),
    );
  }

  // 🔥 NUEVO: Obtener mensajes alrededor de un messageId específico (para jump-to-message)
  @Get('room/:roomCode/around/:messageId')
  async findAroundMessage(
    @Param('roomCode') roomCode: string,
    @Param('messageId') messageId: string,
    @Query('limit') limit: string = '30',
  ) {
    return await this.messagesService.findAroundMessage(
      roomCode,
      parseInt(messageId),
      parseInt(limit),
    );
  }


  @Get('user/:from/:to')
  async findByUser(
    @Param('from') from: string,
    @Param('to') to: string,
    @Query('limit') limit: string = '20',
    @Query('offset') offset: string = '0',
  ) {
    // console.log(`ðŸ‘¤ Obteniendo mensajes entre ${from} y ${to}`);
    return await this.messagesService.findByUser(
      from,
      to,
      parseInt(limit),
      parseInt(offset),
    );
  }

  @Get('user/:from/:to/by-id')
  async findByUserOrderedById(
    @Param('from') from: string,
    @Param('to') to: string,
    @Query('limit') limit: string = '20',
    @Query('offset') offset: string = '0',
  ) {
    return await this.messagesService.findByUserOrderedById(
      from,
      to,
      parseInt(limit),
      parseInt(offset),
    );
  }

  // 🔥 NUEVO: Obtener mensajes alrededor de un messageId para chats individuales
  @Get('user/:from/:to/around/:messageId')
  async findAroundMessageForUser(
    @Param('from') from: string,
    @Param('to') to: string,
    @Param('messageId') messageId: string,
    @Query('limit') limit: string = '30',
  ) {
    return await this.messagesService.findAroundMessageForUser(
      from,
      to,
      parseInt(messageId),
      parseInt(limit),
    );
  }


  @Get('recent')
  async findRecent(@Query('limit') limit: string = '20') {
    // console.log(`ðŸ•’ Obteniendo mensajes recientes`);
    return await this.messagesService.findRecentMessages(parseInt(limit));
  }

  @Put(':id/read')
  async markAsRead(
    @Param('id') id: string,
    @Body('username') username: string,
  ) {
    const message = await this.messagesService.markAsRead(
      parseInt(id),
      username,
    );
    return { success: !!message, message };
  }

  /**
   * 🔥 NUEVO: Obtener lista completa de usuarios que leyeron un mensaje
   * Usado cuando el usuario hace clic en "visto por X personas"
   */
  @Get(':messageId/read-by')
  async getMessageReadBy(@Param('messageId') messageId: string) {
    return this.messagesService.getMessageReadBy(parseInt(messageId));
  }

  // Marcar múltiples mensajes como leídos
  @Patch('mark-read')
  async markMultipleAsRead(@Body() markReadDto: MarkReadDto) {
    if (markReadDto.messageIds && markReadDto.messageIds.length > 0) {
      const messages = await this.messagesService.markMultipleAsRead(
        markReadDto.messageIds,
        markReadDto.username,
      );
      return { success: true, messagesUpdated: messages.length, messages };
    }

    return { success: false, message: 'No message IDs provided' };
  }

  // Marcar toda una conversaciÃ³n como leÃ­da
  @Patch('mark-conversation-read')
  async markConversationAsRead(
    @Body('from') from: string,
    @Body('to') to: string,
  ) {
    const messages = await this.messagesService.markConversationAsRead(
      from,
      to,
    );
    return { success: true, messagesUpdated: messages.length, messages };
  }

  @Put(':id')
  async editMessage(
    @Param('id') id: string,
    @Body('username') username: string,
    @Body('message') message: string,
    @Body('mediaType') mediaType?: string,
    @Body('mediaData') mediaData?: string,
    @Body('fileName') fileName?: string,
    @Body('fileSize') fileSize?: number,
  ) {
    // console.log(`Editando mensaje ${id} por usuario: ${username}`);
    // console.log(`âœï¸ Editando mensaje ${id} por ${username}`);
    const edited = await this.messagesService.editMessage(
      parseInt(id),
      username,
      message,
      mediaType,
      mediaData,
      fileName,
      fileSize,
    );
    return { success: !!edited, message: edited };
  }

  @Delete(':id')
  async deleteMessage(
    @Param('id') id: string,
    @Body('username') username: string,
    @Body('isAdmin') isAdmin?: boolean,
    @Body('deletedBy') deletedBy?: string,
  ) {
    // console.log(
    //   `ðŸ—‘ï¸ Eliminando mensaje ${id} por ${username}${isAdmin ? ' (ADMIN)' : ''}`,
    // );
    const deleted = await this.messagesService.deleteMessage(
      parseInt(id),
      username,
      isAdmin,
      deletedBy,
    );
    return { success: deleted };
  }

  @Get('stats/:roomCode?')
  async getStats(@Param('roomCode') roomCode?: string) {
    // console.log(`ðŸ“Š Obteniendo estadÃ­sticas de mensajes`);
    return await this.messagesService.getMessageStats(roomCode);
  }

  @Get('search/:username')
  async searchMessages(
    @Param('username') username: string,
    @Query('q') searchTerm: string,
    @Query('limit') limit: string = '20',
  ) {
    return await this.messagesService.searchMessages(
      username,
      searchTerm,
      parseInt(limit),
    );
  }

  @Get('search-by-user/:userId')
  async searchMessagesByUserId(
    @Param('userId') userId: string,
    @Query('q') searchTerm: string,
    @Query('limit') limit: string = '20',
  ) {
    return await this.messagesService.searchMessagesByUserId(
      parseInt(userId),
      searchTerm,
      parseInt(limit),
    );
  }

  // 🔥 NUEVO: Búsqueda global de mensajes (tipo WhatsApp) con paginación
  // Busca en todos los chats y grupos donde el usuario participa
  @Get('search-all/:username')
  async searchAllMessages(
    @Param('username') username: string,
    @Query('q') searchTerm: string,
    @Query('limit') limit: string = '15',
    @Query('offset') offset: string = '0',
  ) {
    return await this.messagesService.searchAllMessages(
      username,
      searchTerm,
      parseInt(limit),
      parseInt(offset),
    );
  }

  @Get('thread/:threadId')
  async findThreadMessages(
    @Param('threadId') threadId: string,
    @Query('limit') limit: string = '100',
    @Query('offset') offset: string = '0',
  ) {
    return await this.messagesService.findThreadMessages(
      parseInt(threadId),
      parseInt(limit),
      parseInt(offset),
    );
  }

  // 🔥 NUEVO: Cargar mensajes alrededor de un mensaje específico (para búsqueda tipo WhatsApp)
  @Get('around/:messageId')
  async getMessagesAroundMessage(
    @Param('messageId') messageId: string,
    @Query('before') before: string = '25',
    @Query('after') after: string = '25',
  ) {
    return await this.messagesService.getMessagesAroundMessage(
      parseInt(messageId),
      parseInt(before),
      parseInt(after),
    );
  }

  // 🔥 NUEVO: Obtener hilos padres de un grupo (roomCode)
  @Get('room/:roomCode/threads')
  async findThreadsByRoom(
    @Param('roomCode') roomCode: string,
    @Query('limit') limit: string = '50',
    @Query('offset') offset: string = '0',
  ) {
    return await this.messagesService.findThreadsByRoom(
      roomCode,
      parseInt(limit),
      parseInt(offset),
    );
  }

  // 🔥 NUEVO: Obtener hilos padres de un chat directo (from/to)
  @Get('user/:from/:to/threads')
  async findThreadsByUser(
    @Param('from') from: string,
    @Param('to') to: string,
    @Query('limit') limit: string = '50',
    @Query('offset') offset: string = '0',
  ) {
    return await this.messagesService.findThreadsByUser(
      from,
      to,
      parseInt(limit),
      parseInt(offset),
    );
  }

  @Patch(':id/increment-thread')
  async incrementThreadCount(@Param('id') id: string) {
    await this.messagesService.incrementThreadCount(parseInt(id));
    return { success: true };
  }

  // 🔥 NUEVO: Obtener conteo de mensajes no leídos para un usuario en una sala
  @Get('unread-count/:roomCode/:username')
  async getUnreadCountForUserInRoom(
    @Param('roomCode') roomCode: string,
    @Param('username') username: string,
  ) {
    const unreadCount = await this.messagesService.getUnreadCountForUserInRoom(
      roomCode,
      username,
    );
    return { roomCode, username, unreadCount };
  }

  // 🔥 NUEVO: Obtener conteo de mensajes no leídos para múltiples salas
  @Post('unread-counts')
  async getUnreadCountsForUserInRooms(
    @Body('roomCodes') roomCodes: string[],
    @Body('username') username: string,
  ) {
    const unreadCounts =
      await this.messagesService.getUnreadCountsForUserInRooms(
        roomCodes,
        username,
      );
    return { username, unreadCounts };
  }

  // 🔥 NUEVO: Obtener todos los conteos de mensajes no leídos para un usuario
  @Get('unread-counts')
  async getAllUnreadCountsForUser(@Query('username') username: string) {
    // console.log(`📊 GET /unread-counts llamado para usuario: ${username}`);

    try {
      if (!username) {
        throw new Error('Username is required');
      }

      const unreadCounts =
        await this.messagesService.getAllUnreadCountsForUser(username);
      // console.log(`📊 Devolviendo conteos:`, unreadCounts);
      return unreadCounts;
    } catch (error) {
      console.error(`❌ Error en getAllUnreadCountsForUser:`, error);
      throw error;
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    // Validar que sea un número (para no interceptar rutas como 'recent' si estuvieran mal ordenadas)
    if (isNaN(+id)) {
      return null;
    }
    return this.messagesService.findOne(+id);
  }

}
