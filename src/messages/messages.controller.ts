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
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { User } from '../users/entities/user.entity';
import { SocketGateway } from '../socket/socket.gateway';
import { forwardRef, Inject, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';

@ApiTags('Mensajería')
@ApiBearerAuth()
@Controller('messages')
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @Inject(forwardRef(() => SocketGateway))
    private readonly socketGateway: SocketGateway,
  ) { }

  // 🔥 NUEVO: Endpoint para buscar menciones
  @Get('mentions')
  @ApiOperation({ summary: 'Buscar menciones de usuarios en mensajes' })
  @ApiQuery({ name: 'username', description: 'Username a buscar' })
  @ApiQuery({ name: 'roomCode', required: false, description: 'Filtrar por código de sala' })
  @ApiQuery({ name: 'limit', required: false, description: 'Límite de resultados' })
  @ApiQuery({ name: 'offset', required: false, description: 'Desplazamiento' })
  @ApiResponse({ status: 200, description: 'Lista de menciones encontrada' })
  async searchMentions(
    @Query('username') username: string,
    @Query('roomCode') roomCode?: string,
    @Query('limit') limit: string = '20',
    @Query('offset') offset: string = '0',
  ) {
    if (!username) {
      return { data: [], total: 0, hasMore: false };
    }
    return await this.messagesService.findMentions(
      username,
      roomCode,
      parseInt(limit),
      parseInt(offset),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Crear y enviar un nuevo mensaje' })
  @ApiResponse({ status: 201, description: 'Mensaje creado con éxito' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
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
  @Get('room/:roomCode')
  @ApiOperation({ summary: 'Obtener mensajes por código de sala (orden descendente)' })
  @ApiParam({ name: 'roomCode', description: 'Código de la sala' })
  @ApiQuery({ name: 'limit', required: false, description: 'Límite de mensajes (default: 20)' })
  @ApiQuery({ name: 'offset', required: false, description: 'Desplazamiento (default: 0)' })
  @ApiQuery({ name: 'username', required: false, description: 'Username para cargar info de lectura' })
  @ApiResponse({ status: 200, description: 'Lista de mensajes recuperada' })
  async findByRoom(
    @Param('roomCode') roomCode: string,
    @Query('limit') limit: string = '20',
    @Query('offset') offset: string = '0',
    @Query('username') username?: string,
  ) {
    // console.log(`ðŸ“‹ Obteniendo mensajes de la sala: ${roomCode}`);
    return await this.messagesService.findByRoom(
      roomCode,
      parseInt(limit),
      parseInt(offset),
      username,
    );
  }

  @Get('room/:roomCode/by-id')
  @ApiOperation({ summary: 'Obtener mensajes por código de sala (orden ascendente por ID)' })
  @ApiParam({ name: 'roomCode', description: 'Código de la sala' })
  @ApiQuery({ name: 'limit', required: false, description: 'Límite de mensajes' })
  @ApiQuery({ name: 'offset', required: false, description: 'Desplazamiento' })
  @ApiQuery({ name: 'username', required: false, description: 'Username para cargar info de lectura' })
  @ApiResponse({ status: 200, description: 'Lista de mensajes recuperada' })
  async findByRoomOrderedById(
    @Param('roomCode') roomCode: string,
    @Query('limit') limit: string = '20',
    @Query('offset') offset: string = '0',
    @Query('username') username?: string,
  ) {
    return await this.messagesService.findByRoomOrderedById(
      roomCode,
      parseInt(limit),
      parseInt(offset),
      username,
    );
  }

  // 🔥 NUEVO: Obtener mensajes alrededor de un messageId específico (para jump-to-message)
  @Get('room/:roomCode/around/:messageId')
  @ApiOperation({ summary: 'Obtener mensajes alrededor de un ID específico (para saltar a mensaje)' })
  @ApiParam({ name: 'roomCode', description: 'Código de la sala' })
  @ApiParam({ name: 'messageId', description: 'ID del mensaje central' })
  @ApiQuery({ name: 'limit', required: false, description: 'Cantidad de mensajes a recuperar' })
  @ApiResponse({ status: 200, description: 'Lista de mensajes recuperada' })
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
  @ApiOperation({ summary: 'Obtener mensajes entre dos usuarios (orden descendente)' })
  @ApiParam({ name: 'from', description: 'Username o ID del remitente' })
  @ApiParam({ name: 'to', description: 'Username o ID del destinatario' })
  @ApiQuery({ name: 'limit', required: false, description: 'Límite de mensajes' })
  @ApiQuery({ name: 'offset', required: false, description: 'Desplazamiento' })
  @ApiResponse({ status: 200, description: 'Lista de mensajes recuperada' })
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
  @ApiOperation({ summary: 'Obtener mensajes entre dos usuarios (orden ascendente por ID)' })
  @ApiParam({ name: 'from', description: 'Username o ID del remitente' })
  @ApiParam({ name: 'to', description: 'Username o ID del destinatario' })
  @ApiQuery({ name: 'limit', required: false, description: 'Límite de mensajes' })
  @ApiQuery({ name: 'offset', required: false, description: 'Desplazamiento' })
  @ApiResponse({ status: 200, description: 'Lista de mensajes recuperada' })
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

  // 🔥 NUEVO: Obtener mensajes de sala ANTES de un ID específico (para paginación hacia atrás)
  @Get('room/:roomCode/before/:messageId')
  @ApiOperation({ summary: 'Obtener mensajes de sala anteriores a un ID' })
  @ApiParam({ name: 'roomCode', description: 'Código de la sala' })
  @ApiParam({ name: 'messageId', description: 'ID del mensaje de referencia' })
  @ApiQuery({ name: 'limit', required: false, description: 'Límite de mensajes' })
  @ApiResponse({ status: 200, description: 'Lista de mensajes recuperada' })
  async findByRoomBeforeId(
    @Param('roomCode') roomCode: string,
    @Param('messageId') messageId: string,
    @Query('limit') limit: string = '20',
  ) {
    return await this.messagesService.findByRoomBeforeId(
      roomCode,
      parseInt(messageId),
      parseInt(limit),
    );
  }

  // 🔥 NUEVO: Obtener mensajes privados ANTES de un ID específico
  @Get('user/:from/:to/before/:messageId')
  @ApiOperation({ summary: 'Obtener mensajes privados anteriores a un ID' })
  @ApiParam({ name: 'from', description: 'Username remitente' })
  @ApiParam({ name: 'to', description: 'Username destinatario' })
  @ApiParam({ name: 'messageId', description: 'ID del mensaje de referencia' })
  @ApiQuery({ name: 'limit', required: false, description: 'Límite (default: 20)' })
  @ApiResponse({ status: 200, description: 'Lista de mensajes recuperada' })
  async findByUserBeforeId(
    @Param('from') from: string,
    @Param('to') to: string,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Query('limit') limit = 20,
  ) {
    return this.messagesService.findByUserBeforeId(from, to, messageId, Number(limit));
  }

  // 🔥 NUEVO: Endpoints para cargar mensajes HACIA ADELANTE (después de un ID)
  @Get('room/:roomCode/after/:messageId')
  @ApiOperation({ summary: 'Obtener mensajes de sala posteriores a un ID' })
  @ApiParam({ name: 'roomCode', description: 'Código de la sala' })
  @ApiParam({ name: 'messageId', description: 'ID del mensaje de referencia' })
  @ApiQuery({ name: 'limit', required: false, description: 'Límite' })
  @ApiResponse({ status: 200, description: 'Lista de mensajes recuperada' })
  async findByRoomAfterId(
    @Param('roomCode') roomCode: string,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Query('limit') limit = 20,
  ) {
    return this.messagesService.findByRoomAfterId(roomCode, messageId, Number(limit));
  }

  @Get('user/:from/:to/after/:messageId')
  @ApiOperation({ summary: 'Obtener mensajes privados posteriores a un ID' })
  @ApiParam({ name: 'from', description: 'Username remitente' })
  @ApiParam({ name: 'to', description: 'Username destinatario' })
  @ApiParam({ name: 'messageId', description: 'ID del mensaje de referencia' })
  @ApiQuery({ name: 'limit', required: false, description: 'Límite' })
  @ApiResponse({ status: 200, description: 'Lista de mensajes recuperada' })
  async findByUserAfterId(
    @Param('from') from: string,
    @Param('to') to: string,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Query('limit') limit = 20,
  ) {
    return this.messagesService.findByUserAfterId(from, to, messageId, Number(limit));
  }

  // 🔥 NUEVO: Obtener mensajes alrededor de un messageId para chats individuales
  @Get('user/:from/:to/around/:messageId')
  @ApiOperation({ summary: 'Obtener mensajes privados alrededor de un ID específico' })
  @ApiParam({ name: 'from', description: 'Username remitente' })
  @ApiParam({ name: 'to', description: 'Username destinatario' })
  @ApiParam({ name: 'messageId', description: 'ID del mensaje central' })
  @ApiQuery({ name: 'limit', required: false, description: 'Límite' })
  @ApiResponse({ status: 200, description: 'Lista de mensajes recuperada' })
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
  @ApiOperation({ summary: 'Obtener mensajes interesantes/recientes (vista global)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Límite (default: 20)' })
  @ApiResponse({ status: 200, description: 'Lista de mensajes recuperada' })
  async findRecent(@Query('limit') limit: string = '20') {
    // console.log(`ðŸ•’ Obteniendo mensajes recientes`);
    return await this.messagesService.findRecentMessages(parseInt(limit));
  }

  @Put(':id/read')
  @ApiOperation({ summary: 'Marcar un mensaje específico como leído' })
  @ApiParam({ name: 'id', description: 'ID del mensaje' })
  @ApiBody({ schema: { type: 'object', properties: { username: { type: 'string', description: 'Nombre del usuario que lee' } } } })
  @ApiResponse({ status: 200, description: 'Mensaje marcado como leído' })
  async markAsRead(
    @Param('id') id: string,
    @Body('username') username: string,
  ) {
    const message = await this.messagesService.markAsRead(
      parseInt(id),
      username,
    );

    // 🔥 NOTIFICAR AL SOCKET
    if (message) {
      this.socketGateway.notifyMessageRead(message, username);
    }

    return { success: !!message, message };
  }

  /**
   * 🔥 NUEVO: Obtener lista completa de usuarios que leyeron un mensaje
   * Usado cuando el usuario hace clic en "visto por X personas"
   */
  @Get(':messageId/read-by')
  @ApiOperation({ summary: 'Obtener lista de usuarios que han leído un mensaje' })
  @ApiParam({ name: 'messageId', description: 'ID del mensaje' })
  @ApiResponse({ status: 200, description: 'Lista de usuarios remitida' })
  async getMessageReadBy(@Param('messageId') messageId: string) {
    return this.messagesService.getMessageReadBy(parseInt(messageId));
  }

  // Marcar múltiples mensajes como leídos
  @Patch('mark-read')
  @ApiOperation({ summary: 'Marcar múltiples mensajes como leídos' })
  @ApiBody({ type: MarkReadDto })
  @ApiResponse({ status: 200, description: 'Mensajes marcados como leídos' })
  async markMultipleAsRead(@Body() markReadDto: MarkReadDto) {
    if (markReadDto.messageIds && markReadDto.messageIds.length > 0) {
      const messages = await this.messagesService.markMultipleAsRead(
        markReadDto.messageIds,
        markReadDto.username,
      );

      // 🔥 NOTIFICAR AL SOCKET (Batch)
      if (messages && messages.length > 0) {
        // Enviar notificaciones individuales (idealmente sería un evento batch)
        messages.forEach(msg => this.socketGateway.notifyMessageRead(msg, markReadDto.username));
      }

      return { success: true, messagesUpdated: messages.length, messages };
    }

    return { success: false, message: 'No message IDs provided' };
  }

  // Marcar toda una conversaciÃ³n como leÃ­da
  @Patch('mark-conversation-read')
  @ApiOperation({ summary: 'Marcar todos los mensajes de una conversación como leídos' })
  @ApiBody({ schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } } })
  @ApiResponse({ status: 200, description: 'Conversación marcada como leída' })
  async markConversationAsRead(
    @Body('from') from: string,
    @Body('to') to: string,
  ) {
    const messages = await this.messagesService.markConversationAsRead(
      from,
      to,
    );

    // 🔥 NOTIFICAR AL SOCKET (Batch)
    // El usuario que lee es "from" (el que llama al endpoint)
    if (messages && messages.length > 0) {
      messages.forEach(msg => this.socketGateway.notifyMessageRead(msg, from));
    }

    return { success: true, messagesUpdated: messages.length, messages };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Editar un mensaje existente' })
  @ApiParam({ name: 'id', description: 'ID del mensaje' })
  @ApiBody({
    schema: {
      type: 'object', properties: {
        username: { type: 'string' },
        message: { type: 'string' },
        mediaType: { type: 'string', required: ['false'] },
        mediaData: { type: 'string', required: ['false'] },
        fileName: { type: 'string', required: ['false'] },
        fileSize: { type: 'number', required: ['false'] }
      }
    }
  })
  @ApiResponse({ status: 200, description: 'Mensaje editado con éxito' })
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
  @ApiOperation({ summary: 'Eliminar un mensaje' })
  @ApiParam({ name: 'id', description: 'ID del mensaje' })
  @ApiBody({
    schema: {
      type: 'object', properties: {
        username: { type: 'string' },
        isAdmin: { type: 'boolean', required: ['false'] },
        deletedBy: { type: 'string', required: ['false'] }
      }
    }
  })
  @ApiResponse({ status: 200, description: 'Mensaje eliminado' })
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

  // 🔥 NUEVO: Vaciar todos los mensajes de una sala (grupos/favoritos) - Solo SUPERADMIN
  @Delete('room/:roomCode/clear')
  @ApiOperation({ summary: 'Vaciar todos los mensajes de una sala (Solo Superadmin)' })
  @ApiParam({ name: 'roomCode', description: 'Código de la sala' })
  @ApiBody({ schema: { type: 'object', properties: { deletedBy: { type: 'string' } } } })
  @ApiResponse({ status: 200, description: 'Mensajes eliminados' })
  async clearAllMessagesInRoom(
    @Param('roomCode') roomCode: string,
    @Body('deletedBy') deletedBy: string,
  ) {
    return this.messagesService.clearAllMessagesInRoom(roomCode, deletedBy);
  }

  // 🔥 NUEVO: Vaciar todos los mensajes de una conversación directa - Solo SUPERADMIN
  @Delete('conversation/clear')
  @ApiOperation({ summary: 'Vaciar todos los mensajes de una conversación (Solo Superadmin)' })
  @ApiBody({ schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, deletedBy: { type: 'string' } } } })
  @ApiResponse({ status: 200, description: 'Mensajes eliminados' })
  async clearAllMessagesInConversation(
    @Body('from') from: string,
    @Body('to') to: string,
    @Body('deletedBy') deletedBy: string,
  ) {
    return this.messagesService.clearAllMessagesInConversation(from, to, deletedBy);
  }

  @Get('stats/:roomCode?')
  @ApiOperation({ summary: 'Obtener estadísticas de mensajes' })
  @ApiParam({ name: 'roomCode', required: false, description: 'Código de sala para filtrar estadísticas' })
  @ApiResponse({ status: 200, description: 'Estadísticas recuperadas' })
  async getStats(@Param('roomCode') roomCode?: string) {
    // console.log(`ðŸ“Š Obteniendo estadÃ­sticas de mensajes`);
    return await this.messagesService.getMessageStats(roomCode);
  }

  @Get('search/:username')
  @ApiOperation({ summary: 'Buscar mensajes por username y término de búsqueda' })
  @ApiParam({ name: 'username', description: 'Username del usuario' })
  @ApiQuery({ name: 'q', description: 'Término de búsqueda' })
  @ApiQuery({ name: 'limit', required: false, description: 'Límite' })
  @ApiResponse({ status: 200, description: 'Resultados de búsqueda' })
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
  @ApiOperation({ summary: 'Buscar mensajes por ID de usuario y término de búsqueda' })
  @ApiParam({ name: 'userId', description: 'ID del usuario' })
  @ApiQuery({ name: 'q', description: 'Término de búsqueda' })
  @ApiQuery({ name: 'limit', required: false, description: 'Límite' })
  @ApiResponse({ status: 200, description: 'Resultados de búsqueda' })
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
  @ApiOperation({ summary: 'Búsqueda global de mensajes (tipo WhatsApp) con paginación' })
  @ApiParam({ name: 'username', description: 'Username del usuario participante' })
  @ApiQuery({ name: 'q', description: 'Término de búsqueda' })
  @ApiQuery({ name: 'limit', required: false, description: 'Límite' })
  @ApiQuery({ name: 'offset', required: false, description: 'Desplazamiento' })
  @ApiResponse({ status: 200, description: 'Resultados de búsqueda global' })
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
  @ApiOperation({ summary: 'Obtener mensajes de un hilo' })
  @ApiParam({ name: 'threadId', description: 'ID del mensaje padre (hilo)' })
  @ApiQuery({ name: 'attachmentId', required: false, description: 'ID de adjunto si el hilo es sobre un adjunto' })
  @ApiQuery({ name: 'limit', required: false, description: 'Límite' })
  @ApiQuery({ name: 'offset', required: false, description: 'Desplazamiento' })
  @ApiQuery({ name: 'order', required: false, description: 'Orden (ASC/DESC)' })
  @ApiResponse({ status: 200, description: 'Mensajes del hilo recuperados' })
  async findThreadMessages(
    @Param('threadId') threadId: string,
    @Query('attachmentId') attachmentId?: string, // 🔥 NUEVO
    @Query('limit') limit: string = '100',
    @Query('offset') offset: string = '0',
    @Query('order') order: string = 'ASC',
  ) {
    return await this.messagesService.findThreadMessages(
      parseInt(threadId),
      parseInt(limit),
      parseInt(offset),
      order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC',
      attachmentId ? parseInt(attachmentId) : undefined, // 🔥 NUEVO
    );
  }

  // 🔥 NUEVO: Cargar mensajes alrededor de un mensaje específico (para búsqueda tipo WhatsApp)
  @Get('around/:messageId')
  @ApiOperation({ summary: 'Obtener mensajes alrededor de un mensaje específico (para búsqueda)' })
  @ApiParam({ name: 'messageId', description: 'ID del mensaje central' })
  @ApiQuery({ name: 'before', required: false, description: 'Mensajes anteriores' })
  @ApiQuery({ name: 'after', required: false, description: 'Mensajes posteriores' })
  @ApiResponse({ status: 200, description: 'Mensajes recuperados' })
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
  @ApiOperation({ summary: 'Obtener hilos padres de un grupo' })
  @ApiParam({ name: 'roomCode', description: 'Código de la sala' })
  @ApiQuery({ name: 'limit', required: false, description: 'Límite' })
  @ApiQuery({ name: 'offset', required: false, description: 'Desplazamiento' })
  @ApiQuery({ name: 'search', required: false, description: 'Término de búsqueda' })
  @ApiResponse({ status: 200, description: 'Hilos recuperados' })
  async findThreadsByRoom(
    @Param('roomCode') roomCode: string,
    @Query('limit') limit: string = '50',
    @Query('offset') offset: string = '0',
    @Query('search') search: string = '',
  ) {
    return await this.messagesService.findThreadsByRoom(
      roomCode,
      parseInt(limit),
      parseInt(offset),
      search
    );
  }

  // 🔥 NUEVO: Obtener hilos padres de un chat directo (from/to)
  @Get('user/:from/:to/threads')
  @ApiOperation({ summary: 'Obtener hilos padres de un chat directo' })
  @ApiParam({ name: 'from', description: 'Username remitente' })
  @ApiParam({ name: 'to', description: 'Username destinatario' })
  @ApiQuery({ name: 'limit', required: false, description: 'Límite' })
  @ApiQuery({ name: 'offset', required: false, description: 'Desplazamiento' })
  @ApiQuery({ name: 'search', required: false, description: 'Término de búsqueda' })
  @ApiResponse({ status: 200, description: 'Hilos recuperados' })
  async findThreadsByUser(
    @Param('from') from: string,
    @Param('to') to: string,
    @Query('limit') limit: string = '50',
    @Query('offset') offset: string = '0',
    @Query('search') search: string = '',
  ) {
    return await this.messagesService.findThreadsByUser(
      from,
      to,
      parseInt(limit),
      parseInt(offset),
      search
    );
  }

  @Patch(':id/increment-thread')
  @ApiOperation({ summary: 'Incrementar contador de respuestas de un hilo' })
  @ApiParam({ name: 'id', description: 'ID del mensaje padre' })
  @ApiQuery({ name: 'attachmentId', required: false, description: 'ID de adjunto' })
  @ApiResponse({ status: 200, description: 'Contador incrementado' })
  async incrementThreadCount(
    @Param('id') id: string,
    @Query('attachmentId') attachmentId?: string, // 🔥 NUEVO
  ) {
    await this.messagesService.incrementThreadCount(
      parseInt(id),
      attachmentId ? parseInt(attachmentId) : undefined,
    );
    return { success: true };
  }

  // 🔥 NUEVO: Marcar hilo como leído
  @Patch('thread/:threadId/read')
  @ApiOperation({ summary: 'Marcar un hilo como leído' })
  @ApiParam({ name: 'threadId', description: 'ID del hilo' })
  @ApiBody({ schema: { type: 'object', properties: { username: { type: 'string' } } } })
  @ApiResponse({ status: 200, description: 'Hilo marcado como leído' })
  async markThreadAsRead(
    @Param('threadId') threadId: string,
    @Body('username') username: string, // El usuario que lee
  ) {
    if (!username) throw new BadRequestException('Username is required');
    return await this.messagesService.markThreadAsRead(parseInt(threadId), username);
  }

  // 🔥 NUEVO: Obtener conteo de mensajes no leídos para un usuario en una sala
  @Get('unread-count/:roomCode/:username')
  @ApiOperation({ summary: 'Obtener conteo de no leídos en una sala específica' })
  @ApiParam({ name: 'roomCode', description: 'Código de la sala' })
  @ApiParam({ name: 'username', description: 'Username del usuario' })
  @ApiResponse({ status: 200, description: 'Conteo de no leídos' })
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
  @ApiOperation({ summary: 'Obtener conteos de no leídos para múltiples salas' })
  @ApiBody({ schema: { type: 'object', properties: { roomCodes: { type: 'array', items: { type: 'string' } }, username: { type: 'string' } } } })
  @ApiResponse({ status: 200, description: 'Conteos de no leídos' })
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
  @ApiOperation({ summary: 'Obtener todos los conteos de no leídos para un usuario' })
  @ApiQuery({ name: 'username', description: 'Username del usuario' })
  @ApiResponse({ status: 200, description: 'Conteos de no leídos globales' })
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
  @ApiOperation({ summary: 'Obtener un mensaje por ID' })
  @ApiParam({ name: 'id', description: 'ID del mensaje' })
  @ApiResponse({ status: 200, description: 'Mensaje recuperado' })
  async findOne(@Param('id') id: string) {
    // Validar que sea un número (para no interceptar rutas como 'recent' si estuvieran mal ordenadas)
    if (isNaN(+id)) {
      return null;
    }
    return this.messagesService.findOne(+id);
  }

}
