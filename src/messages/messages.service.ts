import {
  Injectable,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Message } from './entities/message.entity';
import { CreateMessageDto } from './dto/create-message.dto';
import { TemporaryConversation } from '../temporary-conversations/entities/temporary-conversation.entity';
import { TemporaryRoom } from '../temporary-rooms/entities/temporary-room.entity';
import { getPeruDate, formatPeruTime, formatDisplayDate } from '../utils/date.utils';
import { SocketGateway } from '../socket/socket.gateway';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    @InjectRepository(TemporaryRoom)
    private temporaryRoomRepository: Repository<TemporaryRoom>,
    @InjectRepository(TemporaryConversation)
    private temporaryConversationRepository: Repository<TemporaryConversation>,
    @Inject(forwardRef(() => SocketGateway))
    private socketGateway: SocketGateway,
  ) { }

  async create(createMessageDto: CreateMessageDto): Promise<Message> {
    // Log eliminado para optimización

    //  REMOVIDO: La deduplicación por from+message+time era demasiado agresiva
    // Causaba que mensajes legítimos con texto igual (ej: "hola") fueran ignorados
    // La deduplicación debe hacerse a nivel de socket con hash de tiempo más preciso
    const {
      id, // Excluir id del DTO - la BD auto-genera
      conversationId, //  CRÍTICO: Extraer explícitamente para guardarlo
      from,
      to,
      message: messageText,
      time,
      isGroup,
      roomCode,
      threadId,
      ...restDto
    } = createMessageDto;

    //  CRÍTICO: SIEMPRE generar sentAt en el servidor con zona horaria de Perú
    // NO aceptar sentAt del frontend para evitar problemas de zona horaria y duplicados
    const peruDate = getPeruDate();

    // Log eliminado para optimización

    //  NO incluir 'id' - dejar que la BD auto-genere
    const message = this.messageRepository.create({
      from,
      to,
      message: messageText,
      isGroup,
      roomCode,
      threadId,
      conversationId, //  CRÍTICO: Incluir conversationId explícitamente
      ...restDto,
      sentAt: peruDate, //  SIEMPRE usar getPeruDate() del servidor
      time: formatPeruTime(peruDate), //  Calcular time automáticamente
    });

    const savedMessage = await this.messageRepository.save(message);

    //  DEBUG: Verificar que se guardó correctamente
    // console.log('✅ DEBUG mensaje guardado:', {
    //   id: savedMessage.id,
    //   from: savedMessage.from,
    //   fromId: savedMessage.fromId,
    //   conversationId: savedMessage.conversationId, //  Verificar conversationId
    //   senderRole: savedMessage.senderRole,
    //   senderNumeroAgente: savedMessage.senderNumeroAgente,
    // });

    //  NOTA: La actualización de contadores y último mensaje ahora se maneja
    // directamente en socket.gateway.ts cuando se distribuyen los mensajes

    return savedMessage;
  }

  //  NUEVO: Obtener todos los conteos de mensajes no leídos para un usuario
  // 🚀 OPTIMIZADO: Una sola consulta SQL agregada en lugar de N consultas
  async getAllUnreadCountsForUser(
    username: string,
  ): Promise<{ [key: string]: number }> {
    try {
      const result: { [key: string]: number } = {};
      const usernameNormalized = this.normalizeUsername(username);

      // 1. 🚀 OPTIMIZADO: Obtener conteos para TODAS las salas en UNA SOLA consulta
      // En lugar de hacer N consultas (una por sala), hacemos una consulta agregada
      const roomUnreadCounts = await this.messageRepository
        .createQueryBuilder('message')
        .select('message.roomCode', 'roomCode')
        .addSelect('COUNT(*)', 'unreadCount')
        .where('message.isGroup = :isGroup', { isGroup: true })
        .andWhere('message.roomCode IS NOT NULL')
        .andWhere('message.isDeleted = :isDeleted', { isDeleted: false })
        .andWhere('message.threadId IS NULL')
        .andWhere('LOWER(message.from) != LOWER(:username)', { username })
        // Mensajes sin readBy o donde el usuario no está en readBy
        .andWhere(
          "(message.readBy IS NULL OR JSON_LENGTH(message.readBy) = 0 OR NOT JSON_CONTAINS(LOWER(message.readBy), LOWER(:usernameJson)))",
          { usernameJson: JSON.stringify(username) }
        )
        .groupBy('message.roomCode')
        .getRawMany();

      // Mapear resultados al objeto de respuesta
      for (const row of roomUnreadCounts) {
        const count = parseInt(row.unreadCount, 10);
        if (count > 0) {
          result[row.roomCode] = count;
        }
      }

      // 2. 🚀 OPTIMIZADO: Conteos para CONVERSACIONES ASIGNADAS en UNA SOLA consulta
      // Primero obtenemos solo los IDs de conversaciones del usuario (rápido, sin mensajes)
      const allConversations = await this.temporaryConversationRepository.find({
        where: { isActive: true },
        select: ['id', 'participants'], // Solo campos necesarios
      });

      const userConversationIds = allConversations
        .filter((conv) => {
          const participants = conv.participants || [];
          return participants.some(
            (p) => this.normalizeUsername(p) === usernameNormalized,
          );
        })
        .map((conv) => conv.id);

      // Si el usuario tiene conversaciones, hacer UNA consulta agregada
      if (userConversationIds.length > 0) {
        const convUnreadCounts = await this.messageRepository
          .createQueryBuilder('message')
          .select('message.conversationId', 'conversationId')
          .addSelect('COUNT(*)', 'unreadCount')
          .where('message.conversationId IN (:...ids)', { ids: userConversationIds })
          .andWhere('message.isDeleted = :isDeleted', { isDeleted: false })
          .andWhere('message.threadId IS NULL')
          .andWhere('message.isGroup = :isGroup', { isGroup: false })
          .andWhere('LOWER(message.from) != LOWER(:username)', { username })
          .andWhere(
            "(message.readBy IS NULL OR JSON_LENGTH(message.readBy) = 0 OR NOT JSON_CONTAINS(LOWER(message.readBy), LOWER(:usernameJson)))",
            { usernameJson: JSON.stringify(username) }
          )
          .groupBy('message.conversationId')
          .getRawMany();

        for (const row of convUnreadCounts) {
          const count = parseInt(row.unreadCount, 10);
          if (count > 0) {
            result[row.conversationId.toString()] = count;
          }
        }
      }

      return result;
    } catch (error) {
      console.error(`❌ Error en getAllUnreadCountsForUser:`, error);
      throw error;
    }
  }

  async findByRoom(
    roomCode: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<Message[]> {
    // Cargar mensajes en orden ASC por ID (cronológico)
    //  Excluir mensajes de hilos (threadId debe ser null)
    //  INCLUIR mensajes eliminados para mostrarlos como "Mensaje eliminado por..."
    const messages = await this.messageRepository.find({
      where: { roomCode, threadId: IsNull() },
      order: { id: 'ASC' },
      take: limit,
      skip: offset,
    });

    //  OPTIMIZACIÓN: Obtener threadCounts en un solo query en lugar de N queries
    const messageIds = messages.map((m) => m.id);
    const threadCountMap: Record<number, number> = {};
    const lastReplyMap: Record<number, string> = {};

    if (messageIds.length > 0) {
      // Query 1: Obtener conteo de threads para todos los mensajes
      const threadCounts = await this.messageRepository
        .createQueryBuilder('message')
        .select('message.threadId', 'threadId')
        .addSelect('COUNT(*)', 'count')
        .where('message.threadId IN (:...messageIds)', { messageIds })
        .andWhere('message.isDeleted = false')
        .groupBy('message.threadId')
        .getRawMany();

      threadCounts.forEach((row) => {
        threadCountMap[row.threadId] = parseInt(row.count, 10);
      });

      // Query 2: Obtener último mensaje de cada hilo (incluir texto para preview)
      const lastReplies = await this.messageRepository
        .createQueryBuilder('message')
        .select(['message.threadId', 'message.from', 'message.message', 'message.sentAt'])
        .where('message.threadId IN (:...messageIds)', { messageIds })
        .andWhere('message.isDeleted = false')
        .orderBy('message.sentAt', 'DESC')
        .getMany();

      // Agrupar por threadId (solo el primero de cada grupo es el más reciente)
      const seenThreadIds = new Set<number>();
      const lastReplyTextMap: Record<number, string> = {}; //  NUEVO: Mapa para texto del último mensaje
      lastReplies.forEach((reply) => {
        if (!seenThreadIds.has(reply.threadId)) {
          lastReplyMap[reply.threadId] = reply.from;
          lastReplyTextMap[reply.threadId] = reply.message || ''; //  Guardar texto
          seenThreadIds.add(reply.threadId);
        }
      });

      // Asignar valores a cada mensaje
      for (const message of messages) {
        message.threadCount = threadCountMap[message.id] || 0;
        message.lastReplyFrom = lastReplyMap[message.id] || null;
        (message as any).lastReplyText = lastReplyTextMap[message.id] || null; //  NUEVO: Texto del último mensaje
        (message as any).displayDate = formatDisplayDate(message.sentAt);
      }
    }

    // Si no hay mensajes con hilos, igual asignar displayDate
    for (const message of messages) {
      if (!(message as any).displayDate) {
        (message as any).displayDate = formatDisplayDate(message.sentAt);
      }
    }

    return messages;
  }

  async findByRoomOrderedById(
    roomCode: string,
    limit: number = 15,
    offset: number = 0,
  ): Promise<{ data: any[]; total: number; hasMore: boolean; page: number; totalPages: number }> {
    // 🚀 OPTIMIZADO: Usar getManyAndCount() para combinar COUNT + SELECT en una operación
    // Esto reduce de 2 queries a 1, mejorando significativamente el rendimiento
    const [messages, total] = await this.messageRepository
      .createQueryBuilder('message')
      .select([
        'message.id',
        'message.from',
        'message.fromId',
        'message.senderRole',
        'message.senderNumeroAgente',
        'message.to',
        'message.message',
        'message.isGroup',
        'message.groupName',
        'message.roomCode',
        'message.mediaType',
        'message.mediaData',
        'message.fileName',
        'message.fileSize',
        'message.sentAt',
        'message.isRead',
        'message.readBy',
        'message.isDeleted',
        'message.deletedAt',
        'message.deletedBy',
        'message.isEdited',
        'message.editedAt',
        'message.time',
        'message.replyToMessageId',
        'message.replyToSender',
        'message.replyToText',
        'message.replyToSenderNumeroAgente',
        'message.threadId',
        'message.threadCount',
        'message.lastReplyFrom',
        'message.reactions',
        'message.type',
        'message.videoCallUrl',
        'message.videoRoomID',
        'message.conversationId',
        'message.isForwarded',
      ])
      .where('message.roomCode = :roomCode', { roomCode })
      .andWhere('message.threadId IS NULL')
      .andWhere('message.isDeleted = :isDeleted', { isDeleted: false })
      .orderBy('message.id', 'DESC')
      .take(limit)
      .skip(offset)
      .getManyAndCount();

    // 🚀 OPTIMIZACIÓN: Obtener threadCounts en un solo query
    const messageIds = messages.map((m) => m.id);
    const threadCountMap: Record<number, number> = {};
    const lastReplyMap: Record<number, string> = {};

    if (messageIds.length > 0) {
      // Obtener conteo de threads para todos los mensajes en una sola consulta
      const threadCounts = await this.messageRepository
        .createQueryBuilder('message')
        .select('message.threadId', 'threadId')
        .addSelect('COUNT(*)', 'count')
        .where('message.threadId IN (:...messageIds)', { messageIds })
        .andWhere('message.isDeleted = false')
        .groupBy('message.threadId')
        .getRawMany();

      threadCounts.forEach((tc) => {
        threadCountMap[tc.threadId] = parseInt(tc.count);
      });

      // Obtener último mensaje de cada hilo (incluir texto para preview)
      const lastReplies = await this.messageRepository
        .createQueryBuilder('message')
        .select(['message.threadId', 'message.from', 'message.message'])
        .where('message.threadId IN (:...messageIds)', { messageIds })
        .andWhere('message.isDeleted = false')
        .orderBy('message.id', 'DESC')
        .getMany();

      // Agrupar por threadId y tomar el primero (más reciente)
      const seenThreadIds = new Set<number>();
      const lastReplyTextMap: Record<number, string> = {}; //  NUEVO
      lastReplies.forEach((reply) => {
        if (!seenThreadIds.has(reply.threadId)) {
          lastReplyMap[reply.threadId] = reply.from;
          lastReplyTextMap[reply.threadId] = reply.message || ''; //  Guardar texto
          seenThreadIds.add(reply.threadId);
        }
      });

      //  Guardar mapa de texto para uso posterior
      (this as any)._lastReplyTextMap = lastReplyTextMap;
    }

    //  Obtener el mapa de texto (puede estar vacío)
    const lastReplyTextMap: Record<number, string> = (this as any)._lastReplyTextMap || {};

    //  Invertir el orden para que se muestren cronológicamente (más antiguos primero)
    const reversedMessages = messages.reverse();

    //  Calcular información de paginación
    const page = Math.floor(offset / limit) + 1;
    const totalPages = Math.ceil(total / limit);
    const hasMore = offset + messages.length < total;

    // Retornar con numeración por ID, threadCount y metadata de paginación
    const data = reversedMessages.map((msg, index) => ({
      ...msg,
      numberInList: index + 1 + offset,
      threadCount: threadCountMap[msg.id] || 0,
      lastReplyFrom: lastReplyMap[msg.id] || null,
      lastReplyText: lastReplyTextMap[msg.id] || null, //  NUEVO: Texto del último mensaje
      displayDate: formatDisplayDate(msg.sentAt),
    }));

    return {
      data,
      total,
      hasMore,
      page,
      totalPages,
    };
  }

  async findByUser(
    from: string,
    to: string,
    limit: number = 15,
    offset: number = 0,
  ): Promise<Message[]> {
    //  CORREGIDO: Usar búsqueda case-insensitive para nombres de usuarios
    // Esto asegura que solo se retornen mensajes privados entre los dos usuarios específicos
    //  INCLUIR mensajes eliminados para mostrarlos como "Mensaje eliminado por..."
    const messages = await this.messageRepository
      .createQueryBuilder('message')
      .where(
        'LOWER(message.from) = LOWER(:from) AND LOWER(message.to) = LOWER(:to) AND message.threadId IS NULL AND message.isGroup = false',
        { from, to },
      )
      .orWhere(
        'LOWER(message.from) = LOWER(:to) AND LOWER(message.to) = LOWER(:from) AND message.threadId IS NULL AND message.isGroup = false',
        { from, to },
      )
      .orderBy('message.sentAt', 'ASC')
      .take(limit)
      .skip(offset)
      .getMany();

    // Calcular el threadCount real para cada mensaje y el último usuario que respondió
    //  OPTIMIZACIÓN: Usar consultas agregadas en lugar de N queries
    const messageIds = messages.map((m) => m.id);
    const threadCountMap: Record<number, number> = {};
    const lastReplyMap: Record<number, string> = {};

    if (messageIds.length > 0) {
      // Query 1: Obtener conteo de threads para todos los mensajes
      const threadCounts = await this.messageRepository
        .createQueryBuilder('message')
        .select('message.threadId', 'threadId')
        .addSelect('COUNT(*)', 'count')
        .where('message.threadId IN (:...messageIds)', { messageIds })
        .andWhere('message.isDeleted = false')
        .groupBy('message.threadId')
        .getRawMany();

      threadCounts.forEach((row) => {
        threadCountMap[row.threadId] = parseInt(row.count, 10);
      });

      // Query 2: Obtener último mensaje de cada hilo
      const lastReplies = await this.messageRepository
        .createQueryBuilder('message')
        .select(['message.threadId', 'message.from', 'message.sentAt'])
        .where('message.threadId IN (:...messageIds)', { messageIds })
        .andWhere('message.isDeleted = false')
        .orderBy('message.sentAt', 'DESC')
        .getMany();

      const seenThreadIds = new Set<number>();
      lastReplies.forEach((reply) => {
        if (!seenThreadIds.has(reply.threadId)) {
          lastReplyMap[reply.threadId] = reply.from;
          seenThreadIds.add(reply.threadId);
        }
      });
    }

    // Asignar valores a cada mensaje
    for (const message of messages) {
      message.threadCount = threadCountMap[message.id] || 0;
      message.lastReplyFrom = lastReplyMap[message.id] || null;
      (message as any).displayDate = formatDisplayDate(message.sentAt);
    }

    return messages;
  }

  // � OPTIMIZADO: Obtener mensajes entre usuarios ordenados por ID
  async findByUserOrderedById(
    from: string,
    to: string,
    limit: number = 15,
    offset: number = 0,
  ): Promise<any[]> {
    // � OPTIMIZADO: Usar QueryBuilder con campos específicos
    const messages = await this.messageRepository
      .createQueryBuilder('message')
      .select([
        'message.id',
        'message.from',
        'message.fromId',
        'message.senderRole',
        'message.senderNumeroAgente',
        'message.to',
        'message.message',
        'message.isGroup',
        'message.roomCode',
        'message.mediaType',
        'message.mediaData',
        'message.fileName',
        'message.fileSize',
        'message.sentAt',
        'message.isRead',
        'message.readBy',
        'message.isDeleted',
        'message.deletedAt',
        'message.deletedBy',
        'message.isEdited',
        'message.editedAt',
        'message.time',
        'message.replyToMessageId',
        'message.replyToSender',
        'message.replyToText',
        'message.replyToSenderNumeroAgente',
        'message.threadId',
        'message.threadCount',
        'message.lastReplyFrom',
        'message.reactions',
        'message.type',
        'message.conversationId',
        'message.isForwarded',
      ])
      .where(
        '(LOWER(message.from) = LOWER(:from) AND LOWER(message.to) = LOWER(:to)) OR (LOWER(message.from) = LOWER(:to) AND LOWER(message.to) = LOWER(:from))',
        { from, to },
      )
      .andWhere('message.threadId IS NULL')
      .andWhere('message.isGroup = :isGroup', { isGroup: false })
      .andWhere('message.isDeleted = :isDeleted', { isDeleted: false })
      .orderBy('message.id', 'DESC')
      .take(limit)
      .skip(offset)
      .getMany();

    // � OPTIMIZACIÓN: Obtener threadCounts en un solo query
    const messageIds = messages.map((m) => m.id);
    const threadCountMap: Record<number, number> = {};
    const lastReplyMap: Record<number, string> = {};

    if (messageIds.length > 0) {
      // Obtener conteo de threads para todos los mensajes
      const threadCounts = await this.messageRepository
        .createQueryBuilder('message')
        .select('message.threadId', 'threadId')
        .addSelect('COUNT(*)', 'count')
        .where('message.threadId IN (:...messageIds)', { messageIds })
        .andWhere('message.isDeleted = false')
        .groupBy('message.threadId')
        .getRawMany();

      threadCounts.forEach((tc) => {
        threadCountMap[tc.threadId] = parseInt(tc.count);
      });

      // Obtener último mensaje de cada hilo (incluir texto para preview)
      const lastReplies = await this.messageRepository
        .createQueryBuilder('message')
        .select(['message.threadId', 'message.from', 'message.message'])
        .where('message.threadId IN (:...messageIds)', { messageIds })
        .andWhere('message.isDeleted = false')
        .orderBy('message.id', 'DESC')
        .getMany();

      // Agrupar por threadId y tomar el primero (más reciente)
      const seenThreadIds = new Set<number>();
      const lastReplyTextMap: Record<number, string> = {}; //  NUEVO
      lastReplies.forEach((reply) => {
        if (!seenThreadIds.has(reply.threadId)) {
          lastReplyMap[reply.threadId] = reply.from;
          lastReplyTextMap[reply.threadId] = reply.message || ''; //  Guardar texto
          seenThreadIds.add(reply.threadId);
        }
      });

      //  Guardar mapa de texto para uso posterior
      (this as any)._lastReplyTextMapUser = lastReplyTextMap;
    }

    //  Obtener el mapa de texto (puede estar vacío)
    const lastReplyTextMap: Record<number, string> = (this as any)._lastReplyTextMapUser || {};

    //  Invertir el orden para que se muestren cronológicamente (más antiguos primero)
    const reversedMessages = messages.reverse();

    // Agregar numeración secuencial y threadCount
    return reversedMessages.map((msg, index) => ({
      ...msg,
      numberInList: index + 1 + offset,
      threadCount: threadCountMap[msg.id] || 0,
      lastReplyFrom: lastReplyMap[msg.id] || null,
      lastReplyText: lastReplyTextMap[msg.id] || null, //  NUEVO: Texto del último mensaje
      displayDate: formatDisplayDate(msg.sentAt),
    }));
  }

  async findRecentMessages(limit: number = 20): Promise<Message[]> {
    //  Excluir mensajes de hilos (threadId debe ser null)
    return await this.messageRepository.find({
      where: { isDeleted: false, threadId: IsNull() },
      order: { sentAt: 'DESC' },
      take: limit,
    });
  }

  async markAsRead(
    messageId: number,
    username: string,
  ): Promise<Message | null> {
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
    });

    if (message && message.from !== username) {
      // Solo marcar como leído si el usuario NO es el remitente
      if (!message.readBy) {
        message.readBy = [];
      }

      //  Normalizar para verificar si ya leyó
      const alreadyRead = message.readBy.some(
        (u) => u.toLowerCase().trim() === username.toLowerCase().trim(),
      );

      if (!alreadyRead) {
        message.readBy.push(username);
        message.isRead = true;
        message.readAt = new Date();
        await this.messageRepository.save(message);
        return message;
      }
    }
    return null;
  }

  //  NUEVO: Marcar todos los mensajes de una sala como leídos por un usuario
  async markAllMessagesAsReadInRoom(
    roomCode: string,
    username: string,
  ): Promise<number> {
    try {
      const messages = await this.messageRepository.find({
        where: { roomCode, isDeleted: false },
      });

      let updatedCount = 0;
      const updates = [];

      for (const message of messages) {
        // No marcar mensajes propios
        if (
          message.from?.toLowerCase().trim() === username?.toLowerCase().trim()
        ) {
          continue;
        }

        if (!message.readBy) {
          message.readBy = [];
        }

        // Verificar si ya leyó (normalizado)
        const alreadyRead = message.readBy.some(
          (u) => u?.toLowerCase().trim() === username?.toLowerCase().trim(),
        );

        if (!alreadyRead) {
          message.readBy.push(username);
          message.isRead = true;
          message.readAt = new Date();
          updates.push(this.messageRepository.save(message));
          updatedCount++;
        }
      }

      if (updates.length > 0) {
        await Promise.all(updates);
      }

      return updatedCount;
    } catch (error) {
      console.error(
        `❌ Error en markAllMessagesAsReadInRoom - Sala: ${roomCode}, Usuario: ${username}:`,
        error,
      );
      return 0;
    }
  }

  // Marcar múltiples mensajes como leídos
  async markMultipleAsRead(
    messageIds: number[],
    username: string,
  ): Promise<Message[]> {
    const updatedMessages: Message[] = [];

    for (const messageId of messageIds) {
      const message = await this.markAsRead(messageId, username);
      if (message) {
        updatedMessages.push(message);
      }
    }

    return updatedMessages;
  }

  // Marcar todos los mensajes de una conversación como leídos
  async markConversationAsRead(from: string, to: string): Promise<Message[]> {
    const messages = await this.messageRepository.find({
      where: {
        from,
        to,
        isRead: false,
        isDeleted: false,
      },
    });

    const updatedMessages: Message[] = [];

    for (const message of messages) {
      if (!message.readBy) {
        message.readBy = [];
      }
      if (!message.readBy.includes(to)) {
        message.readBy.push(to);
        message.isRead = true;
        message.readAt = new Date();
        await this.messageRepository.save(message);
        updatedMessages.push(message);
      }
    }

    return updatedMessages;
  }

  // Agregar o quitar reacción a un mensaje
  async toggleReaction(
    messageId: number,
    username: string,
    emoji: string,
  ): Promise<Message | null> {
    // console.log(`🔍 toggleReaction - Buscando mensaje ID: ${messageId}`);

    const message = await this.messageRepository.findOne({
      where: { id: messageId },
    });

    if (!message) {
      // console.log(`❌ toggleReaction - Mensaje ${messageId} NO encontrado`);
      return null;
    }

    // console.log(`✅ toggleReaction - Mensaje ${messageId} encontrado`);
    // console.log(`📝 Reacciones actuales:`, JSON.stringify(message.reactions));

    // Inicializar reactions si no existe
    if (!message.reactions) {
      message.reactions = [];
      // console.log(`🆕 Inicializando array de reacciones vacío`);
    }

    // Buscar si el usuario ya reaccionó con este emoji
    const existingReactionIndex = message.reactions.findIndex(
      (r) => r.username === username && r.emoji === emoji,
    );

    if (existingReactionIndex !== -1) {
      // Si ya existe, quitarla
      // console.log(
      //   `🗑️ Quitando reacción existente de ${username} con emoji ${emoji}`,
      // );
      message.reactions.splice(existingReactionIndex, 1);
    } else {
      // Quitar cualquier otra reacción del usuario (solo una reacción por usuario)
      const previousReactions = message.reactions.filter(
        (r) => r.username === username,
      );
      if (previousReactions.length > 0) {
        // console.log(
        //   `🔄 Usuario ${username} ya tenía reacciones, quitándolas:`,
        //   previousReactions,
        // );
      }

      message.reactions = message.reactions.filter(
        (r) => r.username !== username,
      );

      // Agregar la nueva reacción
      // console.log(
      //   `➕ Agregando nueva reacción de ${username} con emoji ${emoji}`,
      // );

      //  Crear timestamp en hora de Perú (UTC-5)
      const now = new Date();
      const peruTime = new Date(now.getTime() - 5 * 60 * 60 * 1000);

      message.reactions.push({
        emoji,
        username,
        timestamp: peruTime,
      });
    }

    // console.log(
    //   `📝 Reacciones después del cambio:`,
    //   JSON.stringify(message.reactions),
    // );
    // console.log(`💾 Guardando mensaje en BD...`);

    const savedMessage = await this.messageRepository.save(message);

    // console.log(`✅ Mensaje guardado exitosamente con reacciones actualizadas`);
    return savedMessage;
  }

  async deleteMessage(
    messageId: number,
    username: string,
    isAdmin: boolean = false,
    deletedBy?: string,
  ): Promise<boolean> {
    //  Si es ADMIN, puede eliminar cualquier mensaje
    const message = isAdmin
      ? await this.messageRepository.findOne({ where: { id: messageId } })
      : await this.messageRepository.findOne({
        where: { id: messageId, from: username },
      });

    if (message) {
      //  NUEVO: Validar si el mensaje pertenece a una sala asignada por admin (solo para usuarios normales)
      if (!isAdmin && message.roomCode) {
        const room = await this.temporaryRoomRepository.findOne({
          where: { roomCode: message.roomCode },
        });

        if (
          room &&
          room.isAssignedByAdmin &&
          room.assignedMembers &&
          room.assignedMembers.includes(username)
        ) {
          throw new BadRequestException(
            'No puedes eliminar mensajes en salas asignadas por un administrador',
          );
        }
      }

      message.isDeleted = true;
      message.deletedAt = new Date();

      //  Si es ADMIN, guardar quién eliminó el mensaje
      if (isAdmin && deletedBy) {
        message.deletedBy = deletedBy;
      }

      await this.messageRepository.save(message);
      return true;
    }
    return false;
  }

  async editMessage(
    messageId: number,
    username: string,
    newText: string,
    mediaType?: string,
    mediaData?: string,
    fileName?: string,
    fileSize?: number,
  ): Promise<Message | null> {
    // console.log(
    //   `✏️ Intentando editar mensaje ID ${messageId} por usuario "${username}"`,
    // );

    //  Primero intentar búsqueda exacta
    let message = await this.messageRepository.findOne({
      where: { id: messageId, from: username },
    });

    //  Si no se encuentra, intentar búsqueda case-insensitive
    if (!message) {
      // console.log(
      //   `⚠️ No se encontró con búsqueda exacta, intentando case-insensitive...`,
      // );
      const allMessages = await this.messageRepository.find({
        where: { id: messageId },
      });

      if (allMessages.length === 0) {
        // console.log(`❌ No existe ningún mensaje con ID ${messageId}`);
        return null;
      }

      // console.log(`🔍 Mensaje encontrado en BD. Comparando usuarios:`);
      // console.log(
      //   `   - Usuario solicitante: "${username}" (normalizado: "${username?.toLowerCase().trim()}")`,
      // );
      // console.log(
      //   `   - Usuario del mensaje: "${allMessages[0].from}" (normalizado: "${allMessages[0].from?.toLowerCase().trim()}")`,
      // );

      // Buscar el mensaje con coincidencia case-insensitive
      message = allMessages.find(
        (msg) =>
          msg.from?.toLowerCase().trim() === username?.toLowerCase().trim(),
      );

      if (message) {
        // console.log(
        //   `✅ Mensaje encontrado con búsqueda case-insensitive: "${message.from}" vs "${username}"`,
        // );
      } else {
        // console.log(
        //   `❌ El mensaje pertenece a otro usuario. No se puede editar.`,
        // );
        return null;
      }
    }

    if (message) {
      // Actualizar texto del mensaje
      message.message = newText;

      //  Actualizar campos multimedia si se proporcionan
      if (mediaType !== undefined) message.mediaType = mediaType;
      if (mediaData !== undefined) message.mediaData = mediaData;
      if (fileName !== undefined) message.fileName = fileName;
      if (fileSize !== undefined) message.fileSize = fileSize;

      message.isEdited = true;
      message.editedAt = new Date();
      await this.messageRepository.save(message);
      // console.log(`✅ Mensaje ${messageId} editado exitosamente`);
      return message;
    }

    // console.log(
    //   `⚠️ No se encontró mensaje con ID ${messageId} del usuario "${username}"`,
    // );
    return null;
  }

  async getMessageStats(
    roomCode?: string,
  ): Promise<{ totalMessages: number; unreadMessages: number }> {
    const whereCondition = roomCode
      ? { roomCode, isDeleted: false }
      : { isDeleted: false };

    const totalMessages = await this.messageRepository.count({
      where: whereCondition,
    });
    const unreadMessages = await this.messageRepository.count({
      where: { ...whereCondition, isRead: false },
    });

    return { totalMessages, unreadMessages };
  }

  //  NUEVO: Obtener conteo de mensajes no leídos por usuario en una sala específica
  async getUnreadCountForUserInRoom(
    roomCode: string,
    username: string,
  ): Promise<number> {
    try {
      // console.log(
      //   `📊 getUnreadCountForUserInRoom - Sala: ${roomCode}, Usuario: ${username}`,
      // );

      const messages = await this.messageRepository.find({
        where: {
          roomCode,
          isDeleted: false,
          threadId: IsNull(), // Solo mensajes principales, no de hilos
        },
        select: ['id', 'from', 'readBy'],
      });

      // console.log(
      //   `📊 Mensajes encontrados en sala ${roomCode}: ${messages.length}`,
      // );

      //  DEBUG: Mostrar algunos mensajes para entender el formato
      if (messages.length > 0) {
        // console.log(`📊 DEBUG - Primeros 3 mensajes en sala ${roomCode}:`);
        // messages.slice(0, 3).forEach((msg, index) => {
        //   console.log(
        //     `  ${index + 1}. ID: ${msg.id}, From: "${msg.from}", ReadBy: ${JSON.stringify(msg.readBy)}`,
        //   );
        // });
      }

      // Contar mensajes que NO han sido leídos por el usuario
      const unreadCount = messages.filter((msg) => {
        // No contar mensajes propios (comparación case-insensitive)
        if (msg.from?.toLowerCase().trim() === username?.toLowerCase().trim()) {
          return false;
        }

        // Si no tiene readBy o está vacío, no ha sido leído
        if (!msg.readBy || msg.readBy.length === 0) {
          return true;
        }

        // Verificar si el usuario está en la lista de lectores (case-insensitive)
        const isReadByUser = msg.readBy.some(
          (reader) =>
            reader?.toLowerCase().trim() === username?.toLowerCase().trim(),
        );

        if (!isReadByUser) {
          // console.log(
          //   `📊 DEBUG - Mensaje ${msg.id} no leído por ${username}: from="${msg.from}", readBy=${JSON.stringify(msg.readBy)}`,
          // );
        }

        return !isReadByUser;
      }).length;

      // console.log(
      //   `📊 Mensajes no leídos para ${username} en sala ${roomCode}: ${unreadCount}`,
      // );
      return unreadCount;
    } catch (error) {
      console.error(
        `❌ Error en getUnreadCountForUserInRoom - Sala: ${roomCode}, Usuario: ${username}:`,
        error,
      );
      return 0;
    }
  }

  //  NUEVO: Obtener conteo de mensajes no leídos para múltiples salas
  async getUnreadCountsForUserInRooms(
    roomCodes: string[],
    username: string,
  ): Promise<{ [roomCode: string]: number }> {
    const result: { [roomCode: string]: number } = {};

    for (const roomCode of roomCodes) {
      result[roomCode] = await this.getUnreadCountForUserInRoom(
        roomCode,
        username,
      );
    }

    return result;
  }

  // Buscar mensajes por contenido para un usuario específico
  async searchMessages(
    username: string,
    searchTerm: string,
    limit: number = 20,
  ): Promise<any[]> {
    // console.log('🔍 searchMessages llamado con:', {
    //   username,
    //   searchTerm,
    //   limit,
    // });

    if (!searchTerm || searchTerm.trim().length === 0) {
      return [];
    }

    //  Buscar TODOS los mensajes del usuario
    // El problema es que algunos mensajes tienen "from" como username (73583958)
    // y otros como nombre completo (BAGNER ANIBAL CHUQUIMIA)
    // Por eso buscamos TODOS los mensajes y luego filtramos
    const allMessages = await this.messageRepository.find({
      where: {
        isDeleted: false,
        threadId: IsNull(),
      },
      order: { sentAt: 'DESC' },
      take: 1000, // Aumentar límite para buscar en más mensajes
    });

    // console.log('📊 Total de mensajes en BD:', allMessages.length);

    // Filtrar mensajes del usuario (por username o que contengan el username en el campo from)
    const userMessages = allMessages.filter((msg) => {
      // Buscar por username exacto o que el campo "from" contenga el username
      return msg.from === username || msg.from?.includes(username);
    });

    // console.log('📊 Mensajes del usuario encontrados:', userMessages.length);
    if (userMessages.length > 0) {
      // console.log('📝 Primer mensaje del usuario:', {
      //   from: userMessages[0].from,
      //   message: userMessages[0].message,
      //   to: userMessages[0].to,
      //   isGroup: userMessages[0].isGroup,
      // });
    }

    // Filtrar por búsqueda en mensaje o nombre de archivo
    const filteredMessages = userMessages.filter((msg) => {
      const searchLower = searchTerm.toLowerCase();
      const messageText = (msg.message || '').toLowerCase();
      const fileName = (msg.fileName || '').toLowerCase();
      return (
        messageText.includes(searchLower) || fileName.includes(searchLower)
      );
    });

    // console.log('✅ Mensajes filtrados por búsqueda:', filteredMessages.length);

    // Limitar resultados al límite especificado
    const limitedResults = filteredMessages.slice(0, limit);

    // Retornar los mensajes con información de la conversación
    return limitedResults.map((msg) => ({
      id: msg.id,
      message: msg.message,
      from: msg.from,
      to: msg.to,
      sentAt: msg.sentAt,
      isGroup: msg.isGroup,
      roomCode: msg.roomCode,
      mediaType: msg.mediaType,
      mediaData: msg.mediaData,
      fileName: msg.fileName,
      fileSize: msg.fileSize,
      // Información adicional para identificar la conversación
      conversationType: msg.isGroup ? 'group' : 'direct',
      conversationId: msg.isGroup ? msg.roomCode : msg.to,
      conversationName: msg.isGroup ? msg.roomCode : msg.to,
    }));
  }

  // Buscar mensajes por ID de usuario
  async searchMessagesByUserId(
    userId: number,
    searchTerm: string,
    limit: number = 20,
  ): Promise<any[]> {
    // console.log('🔍 searchMessagesByUserId llamado con:', {
    //   userId,
    //   searchTerm,
    //   limit,
    // });

    if (!searchTerm || searchTerm.trim().length === 0) {
      return [];
    }

    // Buscar mensajes del usuario por fromId
    const messages = await this.messageRepository.find({
      where: {
        fromId: userId,
        isDeleted: false,
        threadId: IsNull(),
      },
      order: { sentAt: 'DESC' },
      take: 1000, // Buscar en más mensajes
    });

    // console.log('📊 Mensajes del usuario encontrados:', messages.length);
    if (messages.length > 0) {
      // console.log('📝 Primer mensaje del usuario:', {
      //   from: messages[0].from,
      //   fromId: messages[0].fromId,
      //   message: messages[0].message,
      //   to: messages[0].to,
      //   isGroup: messages[0].isGroup,
      // });
    }

    // Filtrar por búsqueda en mensaje o nombre de archivo
    const filteredMessages = messages.filter((msg) => {
      const searchLower = searchTerm.toLowerCase();
      const messageText = (msg.message || '').toLowerCase();
      const fileName = (msg.fileName || '').toLowerCase();
      return (
        messageText.includes(searchLower) || fileName.includes(searchLower)
      );
    });

    // Log eliminado para optimización

    // Limitar resultados al límite especificado
    const limitedResults = filteredMessages.slice(0, limit);

    // Retornar los mensajes con información de la conversación
    return limitedResults.map((msg) => ({
      id: msg.id,
      message: msg.message,
      from: msg.from,
      to: msg.to,
      sentAt: msg.sentAt,
      isGroup: msg.isGroup,
      roomCode: msg.roomCode,
      mediaType: msg.mediaType,
      mediaData: msg.mediaData,
      fileName: msg.fileName,
      fileSize: msg.fileSize,
      // Información adicional para identificar la conversación
      conversationType: msg.isGroup ? 'group' : 'direct',
      conversationId: msg.isGroup ? msg.roomCode : msg.to,
      conversationName: msg.isGroup ? msg.roomCode : msg.to,
    }));
  }

  // Obtener mensajes de un hilo específico
  async findThreadMessages(
    threadId: number,
    limit: number = 100,
    offset: number = 0,
  ): Promise<Message[]> {
    //  CORREGIDO: Usar ID en lugar de sentAt para ordenamiento consistente
    // sentAt puede estar corrupto, así que usamos ID que es más confiable
    return await this.messageRepository.find({
      where: { threadId, isDeleted: false },
      order: { id: 'ASC' },
      take: limit,
      skip: offset,
    });
  }

  // Incrementar contador de respuestas en hilo
  async incrementThreadCount(messageId: number): Promise<void> {
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
    });

    if (message) {
      message.threadCount = (message.threadCount || 0) + 1;
      await this.messageRepository.save(message);
    }
  }

  //  NUEVO: Buscar mensaje de videollamada por videoRoomID
  async findByVideoRoomID(videoRoomID: string): Promise<Message | null> {
    return await this.messageRepository.findOne({
      where: { videoRoomID },
      order: { id: 'DESC' }, // Obtener el más reciente
    });
  }

  //  NUEVO: Fallback para mensajes antiguos sin videoRoomID
  // Buscar la última videollamada por roomCode
  async findLatestVideoCallByRoomCode(roomCode: string): Promise<Message | null> {
    return await this.messageRepository.findOne({
      where: { roomCode, type: 'video_call' },
      order: { id: 'DESC' },
    });
  }

  //  NUEVO: Actualizar mensaje
  async update(messageId: number, updateData: Partial<Message>): Promise<void> {
    await this.messageRepository.update(messageId, updateData);
  }

  //  NUEVO: Obtener mensajes alrededor de un messageId específico (para jump-to-message)
  async findAroundMessage(
    roomCode: string,
    targetMessageId: number,
    limit: number = 30,
  ): Promise<{ messages: any[]; targetIndex: number; hasMoreBefore: boolean; hasMoreAfter: boolean }> {
    const halfLimit = Math.floor(limit / 2);

    // 1. Verificar que el mensaje existe y pertenece a esta sala
    const targetMessage = await this.messageRepository.findOne({
      where: { id: targetMessageId, roomCode, isDeleted: false },
    });

    if (!targetMessage) {
      return { messages: [], targetIndex: -1, hasMoreBefore: false, hasMoreAfter: false };
    }

    // 2. Obtener mensajes ANTES del target (IDs menores, ordenados DESC para tomar los más cercanos)
    const messagesBefore = await this.messageRepository.find({
      where: { roomCode, threadId: IsNull(), isDeleted: false },
      order: { id: 'DESC' },
      take: halfLimit,
      skip: 0,
    });

    // Filtrar solo los que tienen ID menor que el target
    const beforeFiltered = messagesBefore
      .filter(m => m.id < targetMessageId)
      .slice(0, halfLimit)
      .reverse(); // Ordenar cronológicamente

    // 3. Obtener mensajes DESPUÉS del target (IDs mayores, ordenados ASC)
    const messagesAfter = await this.messageRepository.find({
      where: { roomCode, threadId: IsNull(), isDeleted: false },
      order: { id: 'ASC' },
      take: halfLimit + 1, // +1 para verificar si hay más
    });

    // Filtrar solo los que tienen ID mayor que el target
    const afterFiltered = messagesAfter.filter(m => m.id > targetMessageId);
    const hasMoreAfter = afterFiltered.length > halfLimit;
    const afterSliced = afterFiltered.slice(0, halfLimit);

    // 4. Verificar si hay más mensajes antes
    const countBefore = await this.messageRepository.count({
      where: { roomCode, threadId: IsNull(), isDeleted: false },
    });
    const hasMoreBefore = beforeFiltered.length > 0 &&
      await this.messageRepository.count({
        where: { roomCode, threadId: IsNull(), isDeleted: false },
      }) > beforeFiltered.length + 1 + afterSliced.length;

    // 5. Combinar: before + target + after
    const allMessages = [...beforeFiltered, targetMessage, ...afterSliced];

    // 6. Agregar threadCount y displayDate
    const messageIds = allMessages.map(m => m.id);
    const threadCountMap = {};
    const lastReplyMap = {};

    if (messageIds.length > 0) {
      const threadCounts = await this.messageRepository
        .createQueryBuilder('message')
        .select('message.threadId', 'threadId')
        .addSelect('COUNT(*)', 'count')
        .where('message.threadId IN (:...messageIds)', { messageIds })
        .andWhere('message.isDeleted = false')
        .groupBy('message.threadId')
        .getRawMany();

      threadCounts.forEach(tc => {
        threadCountMap[tc.threadId] = parseInt(tc.count);
      });

      const lastReplies = await this.messageRepository
        .createQueryBuilder('message')
        .where('message.threadId IN (:...messageIds)', { messageIds })
        .andWhere('message.isDeleted = false')
        .orderBy('message.sentAt', 'DESC')
        .getMany();

      const seenThreadIds = new Set();
      lastReplies.forEach(reply => {
        if (!seenThreadIds.has(reply.threadId)) {
          lastReplyMap[reply.threadId] = reply.from;
          seenThreadIds.add(reply.threadId);
        }
      });
    }

    const messagesWithMetadata = allMessages.map((msg, index) => ({
      ...msg,
      numberInList: index + 1,
      threadCount: threadCountMap[msg.id] || 0,
      lastReplyFrom: lastReplyMap[msg.id] || null,
      displayDate: formatDisplayDate(msg.sentAt),
    }));

    return {
      messages: messagesWithMetadata,
      targetIndex: beforeFiltered.length, // Índice del mensaje target en el array
      hasMoreBefore: beforeFiltered.length >= halfLimit,
      hasMoreAfter,
    };
  }

  //  NUEVO: Obtener mensajes alrededor de un messageId para chats individuales
  async findAroundMessageForUser(
    from: string,
    to: string,
    targetMessageId: number,
    limit: number = 30,
  ): Promise<{ messages: any[]; targetIndex: number; hasMoreBefore: boolean; hasMoreAfter: boolean }> {
    const halfLimit = Math.floor(limit / 2);

    // 1. Verificar que el mensaje existe
    const targetMessage = await this.messageRepository.findOne({
      where: { id: targetMessageId, isDeleted: false },
    });

    if (!targetMessage) {
      return { messages: [], targetIndex: -1, hasMoreBefore: false, hasMoreAfter: false };
    }

    // 2. Obtener mensajes ANTES del target
    const messagesBefore = await this.messageRepository
      .createQueryBuilder('message')
      .where(
        '((LOWER(message.from) = LOWER(:from) AND LOWER(message.to) = LOWER(:to)) OR (LOWER(message.from) = LOWER(:to) AND LOWER(message.to) = LOWER(:from))) AND message.threadId IS NULL AND message.isGroup = false AND message.isDeleted = false AND message.id < :targetId',
        { from, to, targetId: targetMessageId }
      )
      .orderBy('message.id', 'DESC')
      .take(halfLimit)
      .getMany();

    const beforeFiltered = messagesBefore.reverse();

    // 3. Obtener mensajes DESPUÉS del target
    const messagesAfter = await this.messageRepository
      .createQueryBuilder('message')
      .where(
        '((LOWER(message.from) = LOWER(:from) AND LOWER(message.to) = LOWER(:to)) OR (LOWER(message.from) = LOWER(:to) AND LOWER(message.to) = LOWER(:from))) AND message.threadId IS NULL AND message.isGroup = false AND message.isDeleted = false AND message.id > :targetId',
        { from, to, targetId: targetMessageId }
      )
      .orderBy('message.id', 'ASC')
      .take(halfLimit + 1)
      .getMany();

    const hasMoreAfter = messagesAfter.length > halfLimit;
    const afterSliced = messagesAfter.slice(0, halfLimit);

    // 4. Combinar
    const allMessages = [...beforeFiltered, targetMessage, ...afterSliced];

    // 5. Agregar metadata
    const messagesWithMetadata = allMessages.map((msg, index) => ({
      ...msg,
      numberInList: index + 1,
      displayDate: formatDisplayDate(msg.sentAt),
    }));

    return {
      messages: messagesWithMetadata,
      targetIndex: beforeFiltered.length,
      hasMoreBefore: beforeFiltered.length >= halfLimit,
      hasMoreAfter,
    };
  }

  async findOne(id: number): Promise<Message | null> {

    return await this.messageRepository.findOne({
      where: { id },
      relations: ['room'] // Opcional: si necesitas datos de la sala
    })
  }

  private normalizeUsername(username: string): string {
    return (
      username
        ?.toLowerCase()
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') || ''
    );
  }
}
