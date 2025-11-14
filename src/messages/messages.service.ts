import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Message } from './entities/message.entity';
import { CreateMessageDto } from './dto/create-message.dto';
import { TemporaryRoom } from '../temporary-rooms/entities/temporary-room.entity';
import { getPeruDate } from '../utils/date.utils';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    @InjectRepository(TemporaryRoom)
    private temporaryRoomRepository: Repository<TemporaryRoom>,
  ) {}

  async create(createMessageDto: CreateMessageDto): Promise<Message> {
    // 🔥 NUEVO: Verificar duplicados antes de guardar
    const { from, to, message: messageText, time, isGroup } = createMessageDto;

    // Buscar un mensaje duplicado reciente (dentro de los últimos 5 segundos)
    const recentDuplicate = await this.messageRepository.findOne({
      where: {
        from,
        to: isGroup ? null : to,
        message: messageText,
        time,
        isDeleted: false,
      },
      order: { id: 'DESC' },
    });

    if (recentDuplicate) {
      console.log(`⚠️ Duplicado detectado - Retornando mensaje existente ID: ${recentDuplicate.id}`);
      return recentDuplicate;
    }

    const message = this.messageRepository.create({
      ...createMessageDto,
      sentAt: createMessageDto.sentAt || getPeruDate(),
    });

    return await this.messageRepository.save(message);
  }

  async findByRoom(
    roomCode: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<Message[]> {
    // Cargar mensajes en orden ASC por ID (cronológico)
    // 🔥 Excluir mensajes de hilos (threadId debe ser null)
    // 🔥 INCLUIR mensajes eliminados para mostrarlos como "Mensaje eliminado por..."
    const messages = await this.messageRepository.find({
      where: { roomCode, threadId: IsNull() },
      order: { id: 'ASC' },
      take: limit,
      skip: offset,
    });

    // Calcular el threadCount real para cada mensaje y el último usuario que respondió
    for (const message of messages) {
      const threadCount = await this.messageRepository.count({
        where: { threadId: message.id, isDeleted: false },
      });
      message.threadCount = threadCount;

      // Obtener el último mensaje del hilo (si existe)
      if (threadCount > 0) {
        const lastThreadMessage = await this.messageRepository.findOne({
          where: { threadId: message.id, isDeleted: false },
          order: { sentAt: 'DESC' },
        });
        if (lastThreadMessage) {
          message.lastReplyFrom = lastThreadMessage.from;
        }
      }
    }

    // Los mensajes ya están en orden cronológico por ID
    return messages;
  }

  async findByRoomOrderedById(
    roomCode: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<any[]> {
    // Obtener mensajes ordenados por ID con numeración
    const messages = await this.messageRepository.find({
      where: { roomCode, threadId: IsNull() },
      order: { id: 'ASC' },
      take: limit,
      skip: offset,
    });

    // 🔥 OPTIMIZACIÓN: Obtener threadCounts en un solo query en lugar de uno por mensaje
    const messageIds = messages.map(m => m.id);
    const threadCountMap = {};
    const lastReplyMap = {};

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

      threadCounts.forEach(tc => {
        threadCountMap[tc.threadId] = parseInt(tc.count);
      });

      // Obtener último mensaje de cada hilo
      const lastReplies = await this.messageRepository
        .createQueryBuilder('message')
        .where('message.threadId IN (:...messageIds)', { messageIds })
        .andWhere('message.isDeleted = false')
        .orderBy('message.sentAt', 'DESC')
        .getMany();

      // Agrupar por threadId y tomar el primero (más reciente)
      const seenThreadIds = new Set();
      lastReplies.forEach(reply => {
        if (!seenThreadIds.has(reply.threadId)) {
          lastReplyMap[reply.threadId] = reply.from;
          seenThreadIds.add(reply.threadId);
        }
      });
    }

    // Retornar con numeración por ID y threadCount
    return messages.map((msg, index) => ({
      ...msg,
      numberInList: index + 1 + offset,
      threadCount: threadCountMap[msg.id] || 0,
      lastReplyFrom: lastReplyMap[msg.id] || null,
    }));
  }


  async findByUser(
    from: string,
    to: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<Message[]> {
    // 🔥 CORREGIDO: Usar búsqueda case-insensitive para nombres de usuarios
    // Esto asegura que solo se retornen mensajes privados entre los dos usuarios específicos
    // 🔥 INCLUIR mensajes eliminados para mostrarlos como "Mensaje eliminado por..."
    const messages = await this.messageRepository
      .createQueryBuilder('message')
      .where('LOWER(message.from) = LOWER(:from) AND LOWER(message.to) = LOWER(:to) AND message.threadId IS NULL AND message.isGroup = false', { from, to })
      .orWhere('LOWER(message.from) = LOWER(:to) AND LOWER(message.to) = LOWER(:from) AND message.threadId IS NULL AND message.isGroup = false', { from, to })
      .orderBy('message.sentAt', 'ASC')
      .take(limit)
      .skip(offset)
      .getMany();

    // Calcular el threadCount real para cada mensaje y el último usuario que respondió
    for (const message of messages) {
      const threadCount = await this.messageRepository.count({
        where: { threadId: message.id, isDeleted: false },
      });
      message.threadCount = threadCount;

      // Obtener el último mensaje del hilo (si existe)
      if (threadCount > 0) {
        const lastThreadMessage = await this.messageRepository.findOne({
          where: { threadId: message.id, isDeleted: false },
          order: { sentAt: 'DESC' },
        });
        if (lastThreadMessage) {
          message.lastReplyFrom = lastThreadMessage.from;
        }
      }
    }

    return messages;
  }

  // 🔥 NUEVO: Obtener mensajes entre usuarios ordenados por ID (para evitar problemas con sentAt corrupto)
  async findByUserOrderedById(
    from: string,
    to: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<any[]> {
    // 🔥 Ordenar por ID (orden de inserción) en lugar de sentAt
    const messages = await this.messageRepository
      .createQueryBuilder('message')
      .where('LOWER(message.from) = LOWER(:from) AND LOWER(message.to) = LOWER(:to) AND message.threadId IS NULL AND message.isGroup = false', { from, to })
      .orWhere('LOWER(message.from) = LOWER(:to) AND LOWER(message.to) = LOWER(:from) AND message.threadId IS NULL AND message.isGroup = false', { from, to })
      .orderBy('message.id', 'ASC')
      .take(limit)
      .skip(offset)
      .getMany();

    // 🔥 OPTIMIZACIÓN: Obtener threadCounts en un solo query en lugar de uno por mensaje
    const messageIds = messages.map(m => m.id);
    const threadCountMap = {};
    const lastReplyMap = {};

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

      threadCounts.forEach(tc => {
        threadCountMap[tc.threadId] = parseInt(tc.count);
      });

      // Obtener último mensaje de cada hilo
      const lastReplies = await this.messageRepository
        .createQueryBuilder('message')
        .where('message.threadId IN (:...messageIds)', { messageIds })
        .andWhere('message.isDeleted = false')
        .orderBy('message.sentAt', 'DESC')
        .getMany();

      // Agrupar por threadId y tomar el primero (más reciente)
      const seenThreadIds = new Set();
      lastReplies.forEach(reply => {
        if (!seenThreadIds.has(reply.threadId)) {
          lastReplyMap[reply.threadId] = reply.from;
          seenThreadIds.add(reply.threadId);
        }
      });
    }

    // Agregar numeración secuencial y threadCount
    const messagesWithNumber = messages.map((msg, index) => ({
      ...msg,
      numberInList: index + 1 + offset,
      threadCount: threadCountMap[msg.id] || 0,
      lastReplyFrom: lastReplyMap[msg.id] || null,
    }));

    return messagesWithNumber;
  }

  async findRecentMessages(limit: number = 20): Promise<Message[]> {
    // 🔥 Excluir mensajes de hilos (threadId debe ser null)
    return await this.messageRepository.find({
      where: { isDeleted: false, threadId: IsNull() },
      order: { sentAt: 'DESC' },
      take: limit,
    });
  }

  async markAsRead(messageId: number, username: string): Promise<Message | null> {
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
    });

    if (message && message.from !== username) {
      // Solo marcar como leído si el usuario NO es el remitente
      if (!message.readBy) {
        message.readBy = [];
      }
      if (!message.readBy.includes(username)) {
        message.readBy.push(username);
        message.isRead = true;
        message.readAt = new Date();
        await this.messageRepository.save(message);
        return message;
      }
    }
    return null;
  }

  // Marcar múltiples mensajes como leídos
  async markMultipleAsRead(messageIds: number[], username: string): Promise<Message[]> {
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
    console.log(`🔍 toggleReaction - Buscando mensaje ID: ${messageId}`);

    const message = await this.messageRepository.findOne({
      where: { id: messageId },
    });

    if (!message) {
      console.log(`❌ toggleReaction - Mensaje ${messageId} NO encontrado`);
      return null;
    }

    console.log(`✅ toggleReaction - Mensaje ${messageId} encontrado`);
    console.log(`📝 Reacciones actuales:`, JSON.stringify(message.reactions));

    // Inicializar reactions si no existe
    if (!message.reactions) {
      message.reactions = [];
      console.log(`🆕 Inicializando array de reacciones vacío`);
    }

    // Buscar si el usuario ya reaccionó con este emoji
    const existingReactionIndex = message.reactions.findIndex(
      (r) => r.username === username && r.emoji === emoji,
    );

    if (existingReactionIndex !== -1) {
      // Si ya existe, quitarla
      console.log(`🗑️ Quitando reacción existente de ${username} con emoji ${emoji}`);
      message.reactions.splice(existingReactionIndex, 1);
    } else {
      // Quitar cualquier otra reacción del usuario (solo una reacción por usuario)
      const previousReactions = message.reactions.filter((r) => r.username === username);
      if (previousReactions.length > 0) {
        console.log(`🔄 Usuario ${username} ya tenía reacciones, quitándolas:`, previousReactions);
      }

      message.reactions = message.reactions.filter(
        (r) => r.username !== username,
      );

      // Agregar la nueva reacción
      console.log(`➕ Agregando nueva reacción de ${username} con emoji ${emoji}`);

      // 🔥 Crear timestamp en hora de Perú (UTC-5)
      const now = new Date();
      const peruTime = new Date(now.getTime() - (5 * 60 * 60 * 1000));

      message.reactions.push({
        emoji,
        username,
        timestamp: peruTime,
      });
    }

    console.log(`📝 Reacciones después del cambio:`, JSON.stringify(message.reactions));
    console.log(`💾 Guardando mensaje en BD...`);

    const savedMessage = await this.messageRepository.save(message);

    console.log(`✅ Mensaje guardado exitosamente con reacciones actualizadas`);
    return savedMessage;
  }

  async deleteMessage(messageId: number, username: string, isAdmin: boolean = false, deletedBy?: string): Promise<boolean> {
    // 🔥 Si es ADMIN, puede eliminar cualquier mensaje
    const message = isAdmin
      ? await this.messageRepository.findOne({ where: { id: messageId } })
      : await this.messageRepository.findOne({ where: { id: messageId, from: username } });

    if (message) {
      // 🔥 NUEVO: Validar si el mensaje pertenece a una sala asignada por admin (solo para usuarios normales)
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

      // 🔥 Si es ADMIN, guardar quién eliminó el mensaje
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
    console.log(`✏️ Intentando editar mensaje ID ${messageId} por usuario "${username}"`);

    // 🔥 Primero intentar búsqueda exacta
    let message = await this.messageRepository.findOne({
      where: { id: messageId, from: username },
    });

    // 🔥 Si no se encuentra, intentar búsqueda case-insensitive
    if (!message) {
      console.log(`⚠️ No se encontró con búsqueda exacta, intentando case-insensitive...`);
      const allMessages = await this.messageRepository.find({
        where: { id: messageId },
      });

      if (allMessages.length === 0) {
        console.log(`❌ No existe ningún mensaje con ID ${messageId}`);
        return null;
      }

      console.log(`🔍 Mensaje encontrado en BD. Comparando usuarios:`);
      console.log(`   - Usuario solicitante: "${username}" (normalizado: "${username?.toLowerCase().trim()}")`);
      console.log(`   - Usuario del mensaje: "${allMessages[0].from}" (normalizado: "${allMessages[0].from?.toLowerCase().trim()}")`);

      // Buscar el mensaje con coincidencia case-insensitive
      message = allMessages.find(
        msg => msg.from?.toLowerCase().trim() === username?.toLowerCase().trim()
      );

      if (message) {
        console.log(`✅ Mensaje encontrado con búsqueda case-insensitive: "${message.from}" vs "${username}"`);
      } else {
        console.log(`❌ El mensaje pertenece a otro usuario. No se puede editar.`);
        return null;
      }
    }

    if (message) {
      // Actualizar texto del mensaje
      message.message = newText;

      // 🔥 Actualizar campos multimedia si se proporcionan
      if (mediaType !== undefined) message.mediaType = mediaType;
      if (mediaData !== undefined) message.mediaData = mediaData;
      if (fileName !== undefined) message.fileName = fileName;
      if (fileSize !== undefined) message.fileSize = fileSize;

      message.isEdited = true;
      message.editedAt = new Date();
      await this.messageRepository.save(message);
      console.log(`✅ Mensaje ${messageId} editado exitosamente`);
      return message;
    }

    console.log(`⚠️ No se encontró mensaje con ID ${messageId} del usuario "${username}"`);
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

  // Buscar mensajes por contenido para un usuario específico
  async searchMessages(
    username: string,
    searchTerm: string,
    limit: number = 20,
  ): Promise<any[]> {
    console.log('🔍 searchMessages llamado con:', { username, searchTerm, limit });

    if (!searchTerm || searchTerm.trim().length === 0) {
      return [];
    }

    // 🔥 Buscar TODOS los mensajes del usuario
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

    console.log('📊 Total de mensajes en BD:', allMessages.length);

    // Filtrar mensajes del usuario (por username o que contengan el username en el campo from)
    const userMessages = allMessages.filter(msg => {
      // Buscar por username exacto o que el campo "from" contenga el username
      return msg.from === username || msg.from?.includes(username);
    });

    console.log('📊 Mensajes del usuario encontrados:', userMessages.length);
    if (userMessages.length > 0) {
      console.log('📝 Primer mensaje del usuario:', {
        from: userMessages[0].from,
        message: userMessages[0].message,
        to: userMessages[0].to,
        isGroup: userMessages[0].isGroup
      });
    }

    // Filtrar por búsqueda en mensaje o nombre de archivo
    const filteredMessages = userMessages.filter(msg => {
      const searchLower = searchTerm.toLowerCase();
      const messageText = (msg.message || '').toLowerCase();
      const fileName = (msg.fileName || '').toLowerCase();
      return messageText.includes(searchLower) || fileName.includes(searchLower);
    });

    console.log('✅ Mensajes filtrados por búsqueda:', filteredMessages.length);

    // Limitar resultados al límite especificado
    const limitedResults = filteredMessages.slice(0, limit);

    // Retornar los mensajes con información de la conversación
    return limitedResults.map(msg => ({
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
    console.log('🔍 searchMessagesByUserId llamado con:', { userId, searchTerm, limit });

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

    console.log('📊 Mensajes del usuario encontrados:', messages.length);
    if (messages.length > 0) {
      console.log('📝 Primer mensaje del usuario:', {
        from: messages[0].from,
        fromId: messages[0].fromId,
        message: messages[0].message,
        to: messages[0].to,
        isGroup: messages[0].isGroup
      });
    }

    // Filtrar por búsqueda en mensaje o nombre de archivo
    const filteredMessages = messages.filter(msg => {
      const searchLower = searchTerm.toLowerCase();
      const messageText = (msg.message || '').toLowerCase();
      const fileName = (msg.fileName || '').toLowerCase();
      return messageText.includes(searchLower) || fileName.includes(searchLower);
    });

    console.log('✅ Mensajes filtrados por búsqueda:', filteredMessages.length);

    // Limitar resultados al límite especificado
    const limitedResults = filteredMessages.slice(0, limit);

    // Retornar los mensajes con información de la conversación
    return limitedResults.map(msg => ({
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
    limit: number = 20,
    offset: number = 0,
  ): Promise<Message[]> {
    return await this.messageRepository.find({
      where: { threadId, isDeleted: false },
      order: { sentAt: 'ASC' },
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
}
