import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In, MoreThan, Like } from 'typeorm';
import { Message } from 'src/02.-Services/messages/entities/message.entity';
import { MessageAttachment } from 'src/02.-Services/messages/entities/message-attachment.entity'; // 🔥 NUEVO: Importar entidad
import { CreateMessageDto } from 'src/02.-Services/messages/dto/create-message.dto';
import { TemporaryConversation } from 'src/02.-Services/temporary-conversations/entities/temporary-conversation.entity';
import { TemporaryRoom } from 'src/02.-Services/temporary-rooms/entities/temporary-room.entity';
import { User } from 'src/02.-Services/users/entities/user.entity';
import { getPeruDate, formatPeruTime, formatDisplayDate } from '../../utils/date.utils';
import { SocketGateway } from 'src/03.-Socket/socket/socket.gateway';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    @InjectRepository(TemporaryRoom)
    private temporaryRoomRepository: Repository<TemporaryRoom>,
    @InjectRepository(TemporaryConversation)
    private temporaryConversationRepository: Repository<TemporaryConversation>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(MessageAttachment) // 🔥 NUEVO: Inyectar repositorio de adjuntos
    private attachmentRepository: Repository<MessageAttachment>,
    @Inject(forwardRef(() => SocketGateway))
    private socketGateway: SocketGateway,
  ) {
    // 🔍🔍🔍 INTERCEPTOR GLOBAL: Capturar TODAS las escrituras que modifican readBy
    const originalSave = this.messageRepository.save.bind(this.messageRepository);
    this.messageRepository.save = (async (entityOrEntities: any, ...args: any[]) => {
      const entities = Array.isArray(entityOrEntities) ? entityOrEntities : [entityOrEntities];
      for (const entity of entities) {
        if (entity && entity.readBy && Array.isArray(entity.readBy) && entity.readBy.length > 0) {
          console.log(`🔴🔴🔴 SAVE with readBy - id: ${entity.id}, readBy: ${JSON.stringify(entity.readBy)}`);
          console.log(`🔴🔴🔴 STACK: ${new Error().stack?.split('\n').slice(1, 5).join(' | ')}`);
        }
      }
      return originalSave(entityOrEntities, ...args);
    }) as any;
  }

  private pictureCache = new Map<string, { url: string; expiresAt: number }>();
  private readonly PICTURE_CACHE_TTL = 1000 * 60 * 60 * 24 * 30; // 30 días

  /**
   * 🔥 NUEVO: Resolver todos los posibles identificadores de un usuario
   * para asegurar que se carguen mensajes antiguos (Nombre, Email, DNI)
   */
  async resolveUserAliases(identifier: string): Promise<string[]> {
    if (!identifier) return [];

    const aliases = new Set<string>();
    aliases.add(identifier);

    try {
      // Intentar encontrar al usuario en la BD para obtener sus otros IDs
      const user = await this.userRepository.createQueryBuilder('user')
        .where('user.username = :id', { id: identifier })
        .orWhere('user.email = :id', { id: identifier })
        .orWhere("CONCAT(user.nombre, ' ', user.apellido) = :id", { id: identifier })
        .getOne();

      if (user) {
        if (user.username) aliases.add(user.username);
        if (user.email) aliases.add(user.email);
        if (user.nombre || user.apellido) {
          const fullName = `${user.nombre || ''} ${user.apellido || ''}`.trim();
          if (fullName) aliases.add(fullName);
        }
      }
    } catch (error) {
      console.error(`❌ Error resolviendo alias para [${identifier}]:`, error);
    }

    return Array.from(aliases);
  }

  async markThreadAsRead(threadId: number, username: string) {
    if (!threadId || !username) return { success: false, updatedCount: 0 };

    const readAt = new Date();
    // 🔥 FIX: Resolver nombre completo desde DNI
    const fullName = await this.resolveFullNameForReadBy(username);
    const normalizedFullName = this.normalizeForReadBy(fullName);
    const usernameLower = username?.toLowerCase().trim();
    const fullNameLower = fullName?.toLowerCase().trim();

    // Obtener mensajes del hilos que necesitan actualización
    // 🔥 FIX: Excluir mensajes del propio usuario (DNI o Nombre)
    // 🔥 FIX: Verificar que no esté ya en readBy (DNI o Nombre)
    const messagesToUpdate = await this.messageRepository
      .createQueryBuilder('message')
      .where('message.threadId = :threadId', { threadId })
      .andWhere('LOWER(TRIM(message.from)) != :usernameLower AND LOWER(TRIM(message.from)) != :fullNameLower', { usernameLower, fullNameLower })
      .andWhere(
        "(message.readBy IS NULL OR (NOT JSON_CONTAINS(message.readBy, :usernameJson) AND NOT JSON_CONTAINS(message.readBy, :fullNameJson)))",
        {
          usernameJson: JSON.stringify(this.normalizeForReadBy(username)),
          fullNameJson: JSON.stringify(normalizedFullName)
        }
      )
      .getMany();

    if (messagesToUpdate.length === 0) return { success: true, updatedCount: 0 };

    // Actualizar cada mensaje agregando el usuario normalizado (Nombre) a readBy
    for (const message of messagesToUpdate) {
      if (!message.readBy) {
        message.readBy = [];
      }
      message.readBy.push(normalizedFullName);
      message.isRead = true;
      message.readAt = readAt;
      await this.messageRepository.save(message);

      // Notificar real-time
      this.socketGateway.notifyMessageRead(message, username);
    }

    return { success: true, updatedCount: messagesToUpdate.length };
  }

  // 🔥 NUEVO: Obtener conteo absoluto de respuestas en un hilo
  async getThreadCount(threadId: number): Promise<number> {
    return await this.messageRepository.count({ where: { threadId } });
  }

  async create(createMessageDto: CreateMessageDto): Promise<Message> {
    // Log eliminado para optimización

    // 🔥 REMOVIDO: La deduplicación por from+message+time era demasiado agresiva
    // Causaba que mensajes legítimos con texto igual (ej: "hola") fueran ignorados
    // La deduplicación debe hacerse a nivel de socket con hash de tiempo más preciso
    const {
      id, // Excluir id del DTO - la BD auto-genera
      conversationId, // 🔥 CRÍTICO: Extraer explícitamente para guardarlo
      from,
      to,
      message: messageText,
      time,
      isGroup,
      roomCode,
      threadId,
      attachments, // 🔥 NUEVO: Extraer adjuntos
      ...restDto
    } = createMessageDto;

    // 🔥 FIX: Validar IDs numéricos para evitar ER_TRUNCATED_WRONG_VALUE_FOR_FIELD
    // Si vienen como strings no numéricos (ej: 'gallery-218309'), TypeORM fallará
    const cleanConversationId = (conversationId && !isNaN(Number(conversationId))) ? Number(conversationId) : null;
    const cleanThreadId = (threadId && !isNaN(Number(threadId))) ? Number(threadId) : null;
    const cleanRoomId = (createMessageDto.roomId && !isNaN(Number(createMessageDto.roomId))) ? Number(createMessageDto.roomId) : null;
    const cleanReplyToMessageId = (createMessageDto.replyToMessageId && !isNaN(Number(createMessageDto.replyToMessageId))) ? Number(createMessageDto.replyToMessageId) : null;
    const cleanReplyToAttachmentId = (createMessageDto.replyToAttachmentId && !isNaN(Number(createMessageDto.replyToAttachmentId))) ? Number(createMessageDto.replyToAttachmentId) : null;

    // 🔥 CRÍTICO: SIEMPRE generar sentAt en el servidor con zona horaria de Perú
    // NO aceptar sentAt del frontend para evitar problemas de zona horaria y duplicados
    const peruDate = getPeruDate();

    // Log eliminado para optimización

    // 🔥 NO incluir 'id' - dejar que la BD auto-genere
    const messageData: any = {
      from,
      to,
      message: messageText,
      isGroup,
      roomCode,
      threadId: cleanThreadId,
      conversationId: cleanConversationId,
      roomId: cleanRoomId,
      replyToMessageId: cleanReplyToMessageId,
      replyToAttachmentId: cleanReplyToAttachmentId,
      ...restDto,
      sentAt: peruDate, // 🔥 SIEMPRE usar getPeruDate() del servidor
      time: formatPeruTime(peruDate), // 🔥 Calcular time automáticamente
    };

    const message = this.messageRepository.create(messageData as any) as any as Message;

    const savedMessage = await this.messageRepository.save(message);

    // 🔥 NUEVO: Guardar adjuntos si existen
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      const attachmentsToSave = attachments.map(att => {
        return this.attachmentRepository.create({
          url: att.url,
          type: att.type || 'file', // Usar 'type' de acuerdo a la entidad y DTO
          fileName: att.fileName,
          // 🔥 FIX: Si el attachment no tiene fileSize, usar el del mensaje principal
          fileSize: att.fileSize || restDto.fileSize,
          messageId: savedMessage.id
        });
      });
      await this.attachmentRepository.save(attachmentsToSave);
      savedMessage.attachments = attachmentsToSave;
    } else if (restDto.fileSize && (restDto.mediaType || restDto.mediaData || restDto.fileName)) {
      // 🔥 FIX: Si no hay attachments pero hay fileSize en el mensaje principal, crear uno
      const attachment = this.attachmentRepository.create({
        url: restDto.mediaData || '',
        type: restDto.mediaType || 'file',
        fileName: restDto.fileName,
        fileSize: restDto.fileSize,
        messageId: savedMessage.id
      });
      await this.attachmentRepository.save(attachment);
      savedMessage.attachments = [attachment];
    }

    // 🔥 DEBUG: Verificar que se guardó correctamente
    // console.log('✅ DEBUG mensaje guardado:', {
    //   id: savedMessage.id,
    //   from: savedMessage.from,
    //   fromId: savedMessage.fromId,
    //   conversationId: savedMessage.conversationId, // 🔥 Verificar conversationId
    //   senderRole: savedMessage.senderRole,
    //   senderNumeroAgente: savedMessage.senderNumeroAgente,
    // });

    // 🔥 NUEVO: Manejar replyToAttachmentId
    if (savedMessage.replyToAttachmentId) {
      await this.attachmentRepository.update(
        { id: savedMessage.replyToAttachmentId },
        {
          lastReplyFrom: savedMessage.from,
          lastReplyAt: peruDate
        }
      );
      // Nota: El incremento de threadCount se hace habitualmente vía socket.gateway o un endpoint separado,
      // pero para asegurar consistencia lo hacemos aquí o en el gateway.
    }

    return this.sanitizeMessage(savedMessage);
  }

  // 🔥 NUEVO: Obtener todos los conteos de mensajes no leídos para un usuario
  // 🚀 OPTIMIZADO: Una sola consulta SQL agregada en lugar de N consultas
  async getAllUnreadCountsForUser(
    username: string,
  ): Promise<{ [key: string]: number }> {
    try {
      const result: { [key: string]: number } = {};
      const normalizedReadByDni = this.normalizeForReadBy(username);
      const usernameLower = username?.toLowerCase().trim();

      // 🔥 FIX: Resolver nombre completo desde DNI para buscar en readBy histórico
      const fullName = await this.resolveFullNameForReadBy(username);
      const normalizedReadByFullName = this.normalizeForReadBy(fullName);
      const fullNameLower = fullName?.toLowerCase().trim();

      // 🔥 FIX: Crear un patrón de búsqueda "fuzzy" para nombres históricos incompletos
      // ej. "MOISES FERNANDO MARIN TANTALEAN" -> "%MOISES%TANTALEAN%"
      let fuzzyFullName = `%${fullName}%`;
      if (fullName) {
        const parts = fullName.trim().split(/\s+/);
        if (parts.length > 1) {
          fuzzyFullName = `%${parts[0]}%${parts[parts.length - 1]}%`;
        }
      }

      // 1. Conteos para TODAS las salas - raw SQL
      // 🔥 FIX: Excluir mensajes propios verificando TANTO DNI como nombre completo
      // 🔥 FIX: Verificar readBy buscando AMBOS formatos (DNI y nombre completo)
      const roomUnreadCounts = await this.messageRepository.query(
        `SELECT m.roomCode AS roomCode, COUNT(*) AS unreadCount
         FROM messages m
         WHERE m.isGroup = 1
           AND m.roomCode IS NOT NULL
           AND m.isDeleted = 0
           AND m.threadId IS NULL
           AND LOWER(TRIM(m.\`from\`)) != ?
           AND LOWER(TRIM(m.\`from\`)) != ?
           AND m.roomCode IN (
             SELECT tr.roomCode FROM temporary_rooms tr
             WHERE tr.isActive = 1
               AND (tr.members LIKE ? OR tr.connectedMembers LIKE ? OR tr.assignedMembers LIKE ?)
           )
           AND (
             m.readBy IS NULL
             OR JSON_LENGTH(m.readBy) = 0
             OR (
               JSON_SEARCH(m.readBy, 'one', ?) IS NULL
               AND JSON_SEARCH(m.readBy, 'one', ?) IS NULL
               AND JSON_SEARCH(m.readBy, 'one', ?) IS NULL
             )
           )
         GROUP BY m.roomCode`,
        [usernameLower, fullNameLower, `%${username}%`, `%${username}%`, `%${username}%`, normalizedReadByDni, normalizedReadByFullName, fuzzyFullName]
      );

      for (const row of roomUnreadCounts) {
        const count = parseInt(row.unreadCount, 10);
        if (count > 0) {
          result[row.roomCode] = count;
        }
      }

      // 2. Conteos para CONVERSACIONES ASIGNADAS - raw SQL
      // 🔥 FIX: Misma lógica dual para conversaciones directas
      const convUnreadCounts = await this.messageRepository.query(
        `SELECT m.conversationId AS conversationId, COUNT(*) AS unreadCount
         FROM messages m
         WHERE m.isDeleted = 0
           AND m.threadId IS NULL
           AND m.isGroup = 0
           AND LOWER(TRIM(m.\`from\`)) != ?
           AND LOWER(TRIM(m.\`from\`)) != ?
           AND m.conversationId IN (
             SELECT tc.id FROM temporary_conversations tc
             WHERE tc.isActive = 1
               AND tc.participants LIKE ?
           )
           AND m.isRead = 0
         GROUP BY m.conversationId`,
        [usernameLower, fullNameLower, `%${username}%`]
      );

      for (const row of convUnreadCounts) {
        const count = parseInt(row.unreadCount, 10);
        if (count > 0) {
          result[row.conversationId.toString()] = count;
        }
      }

      return result;
    } catch (error) {
      console.error(`❌ Error en getAllUnreadCountsForUser:`, error);
      throw error;
    }
  }

  // 🔥 NUEVO: Obtener conteo de mensajes no leídos por usuario en una conversación específica
  async getUnreadCountForUserInConversation(
    conversationId: number,
    username: string,
  ): Promise<number> {
    try {
      const messages = await this.messageRepository.find({
        where: {
          conversationId,
          isDeleted: false,
          threadId: IsNull(),
          isGroup: false,
        },
        select: ['id', 'from', 'readBy'],
      });

      // 🔥 RESOLVER ALIAS
      const userAliases = await this.resolveUserAliases(username);
      const userAliasesLower = userAliases.map(a => a.toLowerCase().trim());

      const unreadCount = messages.filter((msg) => {
        // No contar mensajes propios
        const fromLower = msg.from?.toLowerCase().trim();
        if (userAliasesLower.includes(fromLower)) {
          return false;
        }

        // Si no tiene readBy o está vacío, no ha sido leído
        if (!msg.readBy || msg.readBy.length === 0) {
          return true;
        }

        // Verificar si el usuario está en la lista de lectores (usando alias)
        const isReadByUser = msg.readBy.some((reader) => {
          const rLower = reader?.toLowerCase().trim();
          return userAliasesLower.includes(rLower);
        });

        return !isReadByUser;
      }).length;

      return unreadCount;
    } catch (error) {
      console.error('❌ Error al obtener conteo de no leídos en conversación:', error);
      return 0;
    }
  }

  async findByRoom(
    roomCode: string,
    limit: number = 20,
    offset: number = 0,
    username?: string, // 🔥 Nuevo parámetro para validación
  ): Promise<Message[]> {
    // 🔥 VALIDACIÓN DE ACCESO
    if (username) {
      const room = await this.temporaryRoomRepository.findOne({ where: { roomCode } });
      if (room && room.pendingMembers && room.pendingMembers.includes(username)) {
        throw new ForbiddenException(`Tu solicitud para unirte a "${room.name}" está pendiente de aprobación.`);
      }
      // Opcional: Validar si es miembro (si queremos ser estrictos)
    }

    // Cargar mensajes en orden ASC por ID (cronológico)
    // 🔥 Excluir mensajes de hilos (threadId debe ser null)
    // 🔥 INCLUIR mensajes eliminados para mostrarlos como "Mensaje eliminado por..."
    const messages = await this.messageRepository.find({
      where: { roomCode, threadId: IsNull() },
      order: { id: 'ASC' },
      take: limit,
      skip: offset,
    });

    // 🔥 OPTIMIZACIÓN: Obtener threadCounts en un solo query en lugar de N queries
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

      // 🚀 OPTIMIZADO: Truncar texto directamente en SQL
      const lastReplies = await this.messageRepository
        .createQueryBuilder('message')
        .select('message.threadId', 'threadId')
        .addSelect('message.from', 'from')
        .addSelect('CASE WHEN LENGTH(message.message) > 100 THEN CONCAT(SUBSTRING(message.message, 1, 100), "...") ELSE message.message END', 'message')
        .addSelect('message.sentAt', 'sentAt')
        .where('message.threadId IN (:...messageIds)', { messageIds })
        .andWhere('message.isDeleted = false')
        .orderBy('message.sentAt', 'DESC')
        .getRawMany();

      // Agrupar por threadId (solo el primero de cada grupo es el más reciente)
      const seenThreadIds = new Set<number>();
      const lastReplyTextMap: Record<number, string> = {};
      lastReplies.forEach((reply) => {
        if (!seenThreadIds.has(reply.threadId)) {
          lastReplyMap[reply.threadId] = reply.from;
          lastReplyTextMap[reply.threadId] = reply.message || '';
          seenThreadIds.add(reply.threadId);
        }
      });

      // Asignar valores a cada mensaje
      for (const message of messages) {
        message.threadCount = threadCountMap[message.id] || 0;
        message.lastReplyFrom = lastReplyMap[message.id] || null;
        (message as any).lastReplyText = lastReplyTextMap[message.id] || null; // Ya viene truncado desde SQL
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
    username?: string, // 🔥 Nuevo parámetro para validación
  ): Promise<{ data: any[]; total: number; hasMore: boolean; page: number; totalPages: number }> {
    // 🔥 VALIDACIÓN DE ACCESO
    if (username) {
      const room = await this.temporaryRoomRepository.findOne({ where: { roomCode } });
      if (room && room.pendingMembers && room.pendingMembers.includes(username)) {
        throw new ForbiddenException(`Tu solicitud para unirte a "${room.name}" está pendiente de aprobación.`);
      }
    }
    // 🚀 OPTIMIZADO: Payload reducido ~60% eliminando campos innecesarios
    // Campos eliminados: fromId, to, roomCode, deletedAt, conversationId, numberInList, displayDate
    // readBy convertido a readByCount (entero)
    // 🔥 FIX: threadId NO se incluye en el SELECT para evitar confusión en el frontend
    const [messages, total] = await this.messageRepository
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.attachments', 'attachments')
      .select([
        'message.id',
        'message.from',
        'message.senderRole',
        'message.senderNumeroAgente',
        'message.message',
        'message.isGroup',
        'message.groupName',
        'message.mediaType',
        'message.mediaData',
        'message.fileName',
        'message.fileSize',
        'message.sentAt',
        'message.isRead',
        'message.readBy',
        'message.isDeleted',
        'message.deletedBy',
        'message.isEdited',
        'message.editedAt',
        'message.time',
        'message.replyToMessageId',
        'message.replyToSender',
        'message.replyToText',
        'message.replyToSenderNumeroAgente',
        // 🔥 FIX: threadId NO se incluye en el SELECT para evitar confusión en el frontend
        // Los mensajes devueltos son SOLO mensajes principales (no respuestas de hilos)
        'message.threadCount',
        'message.lastReplyFrom',
        'message.reactions',
        'message.type',
        'message.videoCallUrl',
        'message.videoRoomID',
        'message.isForwarded',
        'attachments.id',
        'attachments.url',
        'attachments.type',
        'attachments.fileName',
        'attachments.fileSize',
        'attachments.threadCount',
        'attachments.lastReplyFrom',
        'attachments.lastReplyAt',
      ])
      .where('message.roomCode = :roomCode', { roomCode })
      .andWhere('message.threadId IS NULL')
      .andWhere('message.isDeleted = :isDeleted', { isDeleted: false })
      .orderBy('message.sentAt', 'DESC')
      .take(limit)
      .skip(offset)
      .getManyAndCount();

    // 🚀 OPTIMIZACIÓN: Obtener threadCounts en un solo query
    const messageIds = messages.map((m) => m.id);
    const threadCountMap: Record<number, number> = {};
    const lastReplyMap: Record<number, string> = {};
    const lastReplyTextMap: Record<number, string> = {}; // 🔥 FIX: Definido aquí para scope local seguro

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

      // 🔥 NUEVO: Obtener conteo de mensajes de hilo NO LEÍDOS por el usuario
      const unreadThreadCountMap: Record<number, number> = {};
      if (username) {
        const unreadThreadCounts = await this.messageRepository
          .createQueryBuilder('message')
          .select('message.threadId', 'threadId')
          .addSelect('COUNT(*)', 'count')
          .where('message.threadId IN (:...messageIds)', { messageIds })
          .andWhere('message.isDeleted = false')
          // Mensajes que NO son míos
          .andWhere('message.from != :username', { username })
          // Y que NO he leído - 🚀 OPTIMIZADO: Sin LOWER()
          .andWhere(
            "(message.readBy IS NULL OR JSON_LENGTH(message.readBy) = 0 OR NOT JSON_CONTAINS(message.readBy, :usernameJson))",
            { usernameJson: JSON.stringify(this.normalizeForReadBy(username)) }
          )
          .groupBy('message.threadId')
          .getRawMany();

        unreadThreadCounts.forEach((row) => {
          unreadThreadCountMap[row.threadId] = parseInt(row.count, 10);
        });
      }

      // 🔥 Guardar mapa para uso en el map final
      (this as any)._unreadThreadCountMapRoom = unreadThreadCountMap;

      // 🚀 OPTIMIZADO: Truncar texto directamente en SQL para evitar transferir datos innecesarios
      // Esto es más eficiente que truncar en JavaScript porque la BD nunca envía el texto completo
      const lastReplies = await this.messageRepository
        .createQueryBuilder('message')
        .leftJoin(User, 'user', 'user.username = message.from')
        .select('message.threadId', 'threadId')
        .addSelect('message.from', 'from')
        .addSelect("COALESCE(CONCAT(user.nombre, ' ', user.apellido), message.from)", 'fromName')
        .addSelect('CASE WHEN LENGTH(message.message) > 100 THEN CONCAT(SUBSTRING(message.message, 1, 100), "...") ELSE message.message END', 'message')
        .where('message.threadId IN (:...messageIds)', { messageIds })
        .andWhere('message.isDeleted = false')
        .orderBy('message.sentAt', 'DESC')
        .getRawMany();

      // Agrupar por threadId y tomar el primero (más reciente)
      const seenThreadIds = new Set<number>();
      // map local declarado arriba
      lastReplies.forEach((reply) => {
        if (!seenThreadIds.has(reply.threadId)) {
          lastReplyMap[reply.threadId] = reply.fromName || reply.from;
          lastReplyTextMap[reply.threadId] = reply.message || '';
          seenThreadIds.add(reply.threadId);
        }
      });
    }

    // 🔥 Invertir el orden para que se muestren cronológicamente (más antiguos primero)
    const reversedMessages = messages.reverse();

    // 🔥 Calcular información de paginación
    const page = Math.floor(offset / limit) + 1;
    const totalPages = Math.ceil(total / limit);
    const hasMore = offset + messages.length < total;

    // 🔥 NUEVO: Obtener fotos de perfil de los remitentes (CON CACHÉ)
    const uniqueSenders = [...new Set(messages.map(m => m.from))];
    const userMap: Record<string, string> = {};
    const missingUsernames: string[] = [];
    const now = Date.now();

    // 1. Verificar Caché
    uniqueSenders.forEach(username => {
      const cached = this.pictureCache.get(username);
      if (cached && cached.expiresAt > now) {
        userMap[username] = cached.url;
      } else {
        missingUsernames.push(username);
      }
    });

    // 2. Buscar faltantes en BD y actualizar caché
    if (missingUsernames.length > 0) {
      try {
        // 🔥 FIX CLUSTER: Buscar por username O por Nombre Completo (concatenado)
        // Esto es necesario porque message.from suele ser el Nombre Completo, no el username
        const users = await this.userRepository
          .createQueryBuilder('user')
          .select(['user.username', 'user.nombre', 'user.apellido', 'user.picture'])
          .where('user.username IN (:...names)', { names: missingUsernames })
          .orWhere("CONCAT(COALESCE(user.nombre, ''), ' ', COALESCE(user.apellido, '')) IN (:...names)", { names: missingUsernames })
          .orWhere("CONCAT(COALESCE(user.nombre, ''), ' ', COALESCE(user.apellido, ''), ' ') IN (:...names)", { names: missingUsernames }) // Con espacio opcional
          .getMany();

        users.forEach(u => {
          if (u.picture) {
            const fullName = `${u.nombre || ''} ${u.apellido || ''}`.trim();
            const fullNameWithSpace = `${fullName} `;

            // Intentar matchear con las claves que faltan
            if (missingUsernames.includes(u.username)) {
              userMap[u.username] = u.picture;
              this.pictureCache.set(u.username, { url: u.picture, expiresAt: now + this.PICTURE_CACHE_TTL });
            }
            if (missingUsernames.includes(fullName)) {
              userMap[fullName] = u.picture;
              this.pictureCache.set(fullName, { url: u.picture, expiresAt: now + this.PICTURE_CACHE_TTL });
            }
            if (missingUsernames.includes(fullNameWithSpace)) {
              userMap[fullNameWithSpace] = u.picture;
              this.pictureCache.set(fullNameWithSpace, { url: u.picture, expiresAt: now + this.PICTURE_CACHE_TTL });
            }
          }
        });
      } catch (err) {
        console.error('Error fetching user pictures:', err);
      }
    }

    // 🚀 OPTIMIZADO: Payload reducido - readBy convertido a readByCount
    // Campos eliminados: numberInList, displayDate (se calculan en frontend)
    const data = reversedMessages.map((msg) => {
      // 🔥 FIX: Si los attachments no tienen fileSize, usar el del mensaje principal
      if (msg.attachments && msg.attachments.length > 0 && msg.fileSize) {
        msg.attachments = msg.attachments.map(att => ({
          ...att,
          fileSize: att.fileSize || msg.fileSize
        }));
      }
      // Extraer readBy y convertir a conteo
      const { readBy, ...msgWithoutReadBy } = msg as any;
      const readByCount = Array.isArray(readBy) ? readBy.length : 0;

      const enriched = {
        ...msgWithoutReadBy,
        readByCount, // Solo el conteo, no la lista completa
        threadCount: threadCountMap[msg.id] || 0,
        unreadThreadCount: ((this as any)._unreadThreadCountMapRoom || {})[msg.id] || 0, // 🔥 Mapear conteo no leído
        lastReplyFrom: lastReplyMap[msg.id] || null,
        lastReplyText: lastReplyTextMap[msg.id] || null, // Ya viene truncado desde SQL
        time: formatPeruTime(new Date(msg.sentAt)), // 🔥 RECALCULAR SIEMPRE para asegurar formato AM/PM
        picture: userMap[msg.from] || null, // 🔥 Picture agregado
      };

      return this.sanitizeMessage(enriched); // 🔥 LIMPIEZA TOTAL
    });

    return {
      data,
      total,
      hasMore,
      page,
      totalPages,
    };
  }

  // 🔥 HELPER: Eliminar campos nulos, indefinidos o arrays vacíos para limpiar la respuesta API
  private sanitizeMessage(msg: any): any {
    if (!msg) return msg;

    // Asegurar que es un objeto plano
    const cleanObj = typeof msg.toJSON === 'function' ? msg.toJSON() : { ...msg };

    Object.keys(cleanObj).forEach(key => {
      const val = cleanObj[key];
      if (val === null || val === undefined) {
        delete cleanObj[key];
      } else if (Array.isArray(val) && val.length === 0) {
        delete cleanObj[key];
      } else if (typeof val === 'boolean' && val === false && (key === 'isGroup' || key === 'isRead' || key === 'isDeleted' || key === 'isEdited' || key === 'isForwarded')) {
        // OPCIONAL: Podríamos borrar los booleans false si se desea, pero usualmente son útiles
        // Por ahora los dejamos para mantener claridad en el estado del mensaje
      }
    });

    return cleanObj;
  }

  /**
   * 🔥 NUEVO: Obtener lista completa de usuarios que leyeron un mensaje
   * Endpoint separado para evitar payload pesado en listado de mensajes
   */
  async getMessageReadBy(messageId: number): Promise<{ messageId: number; readBy: string[]; readByCount: number }> {
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
      select: ['id', 'readBy'],
    });

    if (!message) {
      return { messageId, readBy: [], readByCount: 0 };
    }

    const readBy = Array.isArray(message.readBy) ? message.readBy : [];
    return {
      messageId,
      readBy,
      readByCount: readBy.length,
    };
  }

  async findByUser(
    from: string,
    to: string,
    limit: number = 15,
    offset: number = 0,
  ): Promise<Message[]> {
    // 🔥 CORREGIDO: Usar búsqueda case-insensitive para nombres de usuarios
    // Esto asegura que solo se retornen mensajes privados entre los dos usuarios específicos
    // 🔥 INCLUIR mensajes eliminados para mostrarlos como "Mensaje eliminado por..."
    const messages = await this.messageRepository
      .createQueryBuilder('message')
      .where(
        'message.from = :from AND message.to = :to AND message.threadId IS NULL AND message.isGroup = false',
        { from, to },
      )
      .orWhere(
        'message.from = :to AND message.to = :from AND message.threadId IS NULL AND message.isGroup = false',
        { from, to },
      )
      .orderBy('message.sentAt', 'ASC')
      .take(limit)
      .skip(offset)
      .getMany();

    // Calcular el threadCount real para cada mensaje y el último usuario que respondió
    // 🔥 OPTIMIZACIÓN: Usar consultas agregadas en lugar de N queries
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
    // 🔥 RESOLVER ALIAS: Obtener todos los IDs posibles para ambos usuarios
    const fromAliases = await this.resolveUserAliases(from);
    const toAliases = await this.resolveUserAliases(to);

    //  OPTIMIZADO: Usar QueryBuilder con campos específicos
    // 🔥 FIX: NO incluir threadId en el SELECT para conversaciones directas
    // Solo los mensajes principales (threadId IS NULL) deben devolverse
    const messages = await this.messageRepository
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.attachments', 'attachments')
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
        // 🔥 FIX: threadId NO se incluye en el SELECT para evitar confusión en el frontend
        // Los mensajes devueltos son SOLO mensajes principales (no respuestas de hilos)
        'message.threadCount',
        'message.lastReplyFrom',
        'message.reactions',
        'message.type',
        'message.conversationId',
        'message.isForwarded',
        'attachments.id',
        'attachments.url',
        'attachments.type',
        'attachments.fileName',
        'attachments.fileSize',
      ])
      .where(
        '((message.from IN (:...fromAliases) AND message.to IN (:...toAliases)) OR (message.from IN (:...toAliases) AND message.to IN (:...fromAliases)))',
        { fromAliases, toAliases },
      )
      .andWhere('message.threadId IS NULL')
      .andWhere('message.isGroup = :isGroup', { isGroup: false })
      .andWhere('message.isDeleted = :isDeleted', { isDeleted: false })
      .orderBy('message.sentAt', 'DESC')
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

      // 🔥 NUEVO: Obtener conteo de mensajes de hilo NO LEÍDOS por el usuario (from)
      // Asumimos que 'from' es el usuario que consulta
      const unreadThreadCountMap: Record<number, number> = {};
      if (from) {
        const unreadThreadCounts = await this.messageRepository
          .createQueryBuilder('message')
          .select('message.threadId', 'threadId')
          .addSelect('COUNT(*)', 'count')
          .where('message.threadId IN (:...messageIds)', { messageIds })
          .andWhere('message.isDeleted = false')
          // Mensajes que NO son míos
          .andWhere('message.from != :username', { username: from })
          // Y que NO he leído - 🚀 OPTIMIZADO: Sin LOWER()
          .andWhere(
            "(message.readBy IS NULL OR JSON_LENGTH(message.readBy) = 0 OR NOT JSON_CONTAINS(message.readBy, :usernameJson))",
            { usernameJson: JSON.stringify(this.normalizeForReadBy(from)) }
          )
          .groupBy('message.threadId')
          .getRawMany();

        unreadThreadCounts.forEach((row) => {
          unreadThreadCountMap[row.threadId] = parseInt(row.count, 10);
        });
      }

      // 🔥 Guardar mapa para uso en el map final
      (this as any)._unreadThreadCountMapUser = unreadThreadCountMap;

      // 🚀 OPTIMIZADO: Truncar texto directamente en SQL
      const lastReplies = await this.messageRepository
        .createQueryBuilder('message')
        .leftJoin(User, 'user', 'user.username = message.from')
        .select('message.threadId', 'threadId')
        .addSelect('message.from', 'from')
        .addSelect("COALESCE(CONCAT(user.nombre, ' ', user.apellido), message.from)", 'fromName')
        .addSelect('CASE WHEN LENGTH(message.message) > 100 THEN CONCAT(SUBSTRING(message.message, 1, 100), "...") ELSE message.message END', 'message')
        .where('message.threadId IN (:...messageIds)', { messageIds })
        .andWhere('message.isDeleted = false')
        .orderBy('message.sentAt', 'DESC')
        .getRawMany();

      // Agrupar por threadId y tomar el primero (más reciente)
      const seenThreadIds = new Set<number>();
      const lastReplyTextMap: Record<number, string> = {};
      lastReplies.forEach((reply) => {
        if (!seenThreadIds.has(reply.threadId)) {
          lastReplyMap[reply.threadId] = reply.fromName || reply.from;
          lastReplyTextMap[reply.threadId] = reply.message || '';
          seenThreadIds.add(reply.threadId);
        }
      });

      // 🔥 Guardar mapa de texto para uso posterior
      (this as any)._lastReplyTextMapUser = lastReplyTextMap;
    }

    // 🔥 Obtener el mapa de texto (puede estar vacío)
    const lastReplyTextMap: Record<number, string> = (this as any)._lastReplyTextMapUser || {};

    // 🔥 Invertir el orden para que se muestren cronológicamente (más antiguos primero)
    const reversedMessages = messages.reverse();

    // Agregar numeración secuencial y threadCount
    return reversedMessages.map((msg, index) => {
      // 🔥 FIX: Si los attachments no tienen fileSize, usar el del mensaje principal
      if (msg.attachments && msg.attachments.length > 0 && msg.fileSize) {
        msg.attachments = msg.attachments.map(att => ({
          ...att,
          fileSize: att.fileSize || msg.fileSize
        }));
      }
      const enriched = {
        ...msg,
        numberInList: index + 1 + offset,
        threadCount: threadCountMap[msg.id] || 0,
        unreadThreadCount: ((this as any)._unreadThreadCountMapUser || {})[msg.id] || 0, // 🔥 Mapear conteo no leído
        lastReplyFrom: lastReplyMap[msg.id] || null,
        lastReplyText: lastReplyTextMap[msg.id] || null, // Ya viene truncado desde SQL
        displayDate: formatDisplayDate(msg.sentAt),
        time: formatPeruTime(new Date(msg.sentAt)), // 🔥 RECALCULAR SIEMPRE para asegurar formato AM/PM
      };
      return this.sanitizeMessage(enriched);
    });
  }

  async findRecentMessages(limit: number = 20): Promise<Message[]> {
    // 🔥 Excluir mensajes de hilos (threadId debe ser null)
    const messages = await this.messageRepository.find({
      where: { isDeleted: false, threadId: IsNull() },
      order: { sentAt: 'DESC' },
      take: limit,
    });
    return messages.map(m => this.sanitizeMessage(m));
  }

  // 🔥 NUEVO: Buscar menciones para un usuario
  async findMentions(
    username: string,
    roomCode?: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<{ data: any[]; total: number; hasMore: boolean; page: number; totalPages: number }> {
    const query = this.messageRepository
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.attachments', 'attachments')
      .select([
        'message.id',
        'message.from',
        'message.senderRole',
        'message.senderNumeroAgente',
        'message.message',
        'message.isGroup',
        'message.groupName',
        'message.roomCode',
        'message.sentAt',
        'message.isRead',
        'message.threadId', // Importante para saber si es respuesta en hilo
        'message.replyToMessageId',
        'attachments.id',
        'attachments.url',
        'attachments.type',
        'attachments.fileName',
        'attachments.fileSize',
      ])
      // Buscar mensajes que contengan @username (case insensitive)
      .where('LOWER(message.message) LIKE LOWER(:mentionPattern)', { mentionPattern: `%@${username}%` })
      .andWhere('message.isDeleted = :isDeleted', { isDeleted: false });

    // Si se especifica una sala, filtrar por ella (contextual)
    // Si no, busca en todas (global)
    if (roomCode) {
      query.andWhere('message.roomCode = :roomCode', { roomCode });
    }

    // Ordenar por fecha descendente (lo más reciente primero)
    query.orderBy('message.sentAt', 'DESC');

    const [messages, total] = await query
      .take(limit)
      .skip(offset)
      .getManyAndCount();

    // Formatear respuesta
    const data = messages.map((msg) => {
      const enriched = {
        ...msg,
        displayDate: formatDisplayDate(msg.sentAt),
        time: formatPeruTime(new Date(msg.sentAt)),
      };
      return this.sanitizeMessage(enriched);
    });

    const page = Math.floor(offset / limit) + 1;
    const totalPages = Math.ceil(total / limit);
    const hasMore = offset + messages.length < total;

    return {
      data,
      total,
      hasMore,
      page,
      totalPages,
    };
  }

  async markAsRead(
    messageId: number,
    username: string,
  ): Promise<Message | null> {
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
    });

    // 🔥 FIX: Resolver nombre completo desde DNI para compatibilidad con readBy histórico
    const fullName = await this.resolveFullNameForReadBy(username);
    const fromLower = message?.from?.toLowerCase().trim();
    const usernameLower = username?.toLowerCase().trim();
    const fullNameLower = fullName?.toLowerCase().trim();

    if (message && fromLower !== usernameLower && fromLower !== fullNameLower) {
      // Solo marcar como leído si el usuario NO es el remitente
      if (!message.readBy) {
        message.readBy = [];
      }

      // 🔥 FIX: Verificar si ya leyó comparando TANTO DNI como nombre completo
      const alreadyRead = message.readBy.some((u) => {
        const rLower = u?.toLowerCase().trim();
        return rLower === usernameLower || rLower === fullNameLower;
      });

      if (!alreadyRead) {
        // 🔥 FIX: Guardar NOMBRE COMPLETO (no DNI) para mantener compatibilidad con readBy existente
        message.readBy.push(this.normalizeForReadBy(fullName));
        message.isRead = true;
        message.readAt = new Date();
        await this.messageRepository.save(message);
        return message;
      }
    }
    return null;
  }

  // 🔥 MODIFICADO: Marcar todos los mensajes de una sala como leídos y devolver info para real-time
  async markAllMessagesAsReadInRoom(
    roomCode: string,
    username: string,
  ): Promise<{ updatedCount: number; updatedMessages: { id: number; readBy: string[]; readAt: Date }[] }> {
    // console.log(`🚨 markAllMessagesAsReadInRoom - room: ${roomCode}, user: ${username}`);
    try {
      if (!roomCode || !username) return { updatedCount: 0, updatedMessages: [] };

      const readAt = new Date();
      // 🔥 FIX: Resolver nombre completo desde DNI
      const fullName = await this.resolveFullNameForReadBy(username);
      const normalizedFullName = this.normalizeForReadBy(fullName);
      const usernameLower = username?.toLowerCase().trim();
      const fullNameLower = fullName?.toLowerCase().trim();

      // 🚀 OPTIMIZADO: Obtener IDs y readBy actual de una vez
      // 🔥 FIX: Excluir mensajes del usuario verificando TANTO DNI como nombre completo
      const messagesToUpdate = await this.messageRepository
        .createQueryBuilder('message')
        .select(['message.id', 'message.readBy'])
        .where('message.roomCode = :roomCode', { roomCode })
        .andWhere('message.isDeleted = :isDeleted', { isDeleted: false })
        .andWhere('LOWER(TRIM(message.from)) != :usernameLower AND LOWER(TRIM(message.from)) != :fullNameLower', { usernameLower, fullNameLower })
        .andWhere(
          "(message.readBy IS NULL OR JSON_LENGTH(message.readBy) = 0 OR (NOT JSON_CONTAINS(message.readBy, :usernameJson) AND NOT JSON_CONTAINS(message.readBy, :fullNameJson)))",
          { usernameJson: JSON.stringify(this.normalizeForReadBy(username)), fullNameJson: JSON.stringify(normalizedFullName) }
        )
        .getMany();

      if (messagesToUpdate.length === 0) {
        return { updatedCount: 0, updatedMessages: [] };
      }

      const messageIds = messagesToUpdate.map(m => m.id);

      const BATCH_SIZE = 250;
      const updatedMessages: { id: number; readBy: string[]; readAt: Date }[] = [];
      let updatedCount = 0;

      for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
        const batchIds = messageIds.slice(i, i + BATCH_SIZE);
        const batchObjects = messagesToUpdate.slice(i, i + BATCH_SIZE);

        // 🔥 FIX: Guardar NOMBRE COMPLETO en readBy (no DNI)
        await this.messageRepository
          .createQueryBuilder()
          .update()
          .set({
            readBy: () => `JSON_ARRAY_APPEND(COALESCE(readBy, JSON_ARRAY()), '$', '${normalizedFullName}')`,
            isRead: true,
            readAt: readAt
          })
          .where('id IN (:...ids)', { ids: batchIds })
          .execute();

        batchObjects.forEach((msg) => {
          updatedMessages.push({
            id: msg.id,
            readBy: [...(msg.readBy || []), normalizedFullName],
            readAt: readAt,
          });
        });

        updatedCount += batchIds.length;
      }

      return { updatedCount, updatedMessages };
    } catch (error) {
      console.error(
        `❌ Error en markAllMessagesAsReadInRoom - Sala: ${roomCode}, Usuario: ${username}:`,
        error,
      );
      // No lanzamos error para no romper el flujo, pero registramos
      return { updatedCount: 0, updatedMessages: [] };
    }
  }

  // Marcar múltiples mensajes como leídos
  // 🚀 OPTIMIZADO: Marcar múltiples mensajes como leídos en lotes
  async markMultipleAsRead(
    messageIds: number[],
    username: string,
  ): Promise<Message[]> {
    if (messageIds.length === 0) return [];

    const readAt = new Date();
    // 🔥 FIX: Resolver nombre completo desde DNI
    const fullName = await this.resolveFullNameForReadBy(username);
    const normalizedFullName = this.normalizeForReadBy(fullName);
    const fullNameLower = fullName?.toLowerCase().trim();

    // 🚀 Obtener solo los mensajes que necesitan actualización
    // 🔥 FIX: Verificar TANTO DNI como nombre completo
    const messagesToUpdate = await this.messageRepository
      .createQueryBuilder('message')
      .where('message.id IN (:...ids)', { ids: messageIds })
      .andWhere('LOWER(TRIM(message.from)) != :usernameLower AND LOWER(TRIM(message.from)) != :fullNameLower', { usernameLower: username?.toLowerCase().trim(), fullNameLower })
      .andWhere(
        "(message.readBy IS NULL OR (NOT JSON_CONTAINS(message.readBy, :usernameJson) AND NOT JSON_CONTAINS(message.readBy, :fullNameJson)))",
        { usernameJson: JSON.stringify(this.normalizeForReadBy(username)), fullNameJson: JSON.stringify(normalizedFullName) }
      )
      .getMany();

    if (messagesToUpdate.length === 0) return [];

    // 🚀 Actualizar en lotes
    const BATCH_SIZE = 50;
    const updatedMessages: Message[] = [];

    for (let i = 0; i < messagesToUpdate.length; i += BATCH_SIZE) {
      const batch = messagesToUpdate.slice(i, i + BATCH_SIZE);
      const batchIds = batch.map((m) => m.id);

      // 🔥 FIX: Guardar NOMBRE COMPLETO en readBy (no DNI)
      await this.messageRepository
        .createQueryBuilder()
        .update()
        .set({
          readBy: () => `JSON_ARRAY_APPEND(COALESCE(readBy, JSON_ARRAY()), '$', '${normalizedFullName}')`,
          isRead: true,
          readAt: readAt
        })
        .where('id IN (:...ids)', { ids: batchIds })
        .execute();

      batch.forEach((message) => {
        message.readBy = [...(message.readBy || []), normalizedFullName];
        message.isRead = true;
        message.readAt = readAt;
        updatedMessages.push(message);
      });
    }

    return updatedMessages;
  }

  // 🚀 OPTIMIZADO: Marcar todos los mensajes de una conversación como leídos
  async markConversationAsRead(from: string, to: string): Promise<Message[]> {
    const readAt = new Date();
    // 🔥 RESOLVER ALIAS para asegurar que encontramos mensajes viejos
    const fromAliases = await this.resolveUserAliases(from);
    const toAliases = await this.resolveUserAliases(to);

    // 🔥 Resolver nombre completo para marcar en 'readBy' (compatibilidad)
    const fullNameFrom = await this.resolveFullNameForReadBy(from);
    const normalizedFullNameFrom = this.normalizeForReadBy(fullNameFrom);

    // 🚀 Obtener solo los mensajes que necesitan actualización
    // (Mensajes enviados por 'to' hacia 'from' que yo no he leído)
    const messages = await this.messageRepository
      .createQueryBuilder('message')
      .where('message.from IN (:...toAliases) AND message.to IN (:...fromAliases)', {
        fromAliases,
        toAliases,
      })
      .andWhere('message.isRead = :isRead', { isRead: false })
      .andWhere('message.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere(
        "(message.readBy IS NULL OR NOT JSON_CONTAINS(message.readBy, :userJson))",
        { userJson: JSON.stringify(normalizedFullNameFrom) }
      )
      .getMany();

    if (messages.length === 0) {
      return [];
    }

    // 🚀 Actualizar en lotes
    const BATCH_SIZE = 100;
    const updatedMessages: Message[] = [];

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      const batchIds = batch.map((m) => m.id);

      // 🔥 FIX: Guardar NOMBRE COMPLETO en readBy
      await this.messageRepository
        .createQueryBuilder()
        .update()
        .set({
          readBy: () => `JSON_ARRAY_APPEND(COALESCE(readBy, JSON_ARRAY()), '$', '${normalizedFullNameFrom}')`,
          isRead: true,
          readAt: readAt
        })
        .where('id IN (:...ids)', { ids: batchIds })
        .execute();

      batch.forEach((message) => {
        const newReadBy = [...(message.readBy || []), normalizedFullNameFrom];
        message.readBy = newReadBy;
        message.isRead = true;
        message.readAt = readAt;
        updatedMessages.push(message);
      });
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

      // 🔥 Crear timestamp en hora de Perú (UTC-5)
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
    // 🔥 Si es ADMIN, puede eliminar cualquier mensaje
    const message = isAdmin
      ? await this.messageRepository.findOne({ where: { id: messageId } })
      : await this.messageRepository.findOne({
        where: { id: messageId, from: username },
      });

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

  // 🔥 NUEVO: Vaciar todos los mensajes de una sala (grupos/favoritos) - Solo SUPERADMIN
  async clearAllMessagesInRoom(
    roomCode: string,
    deletedBy: string,
  ): Promise<{ deletedCount: number }> {
    const result = await this.messageRepository.update(
      { roomCode, isDeleted: false },
      { isDeleted: true, deletedAt: new Date(), deletedBy },
    );
    return { deletedCount: result.affected || 0 };
  }

  // 🔥 NUEVO: Vaciar todos los mensajes de una conversación directa (chats asignados) - Solo SUPERADMIN
  async clearAllMessagesInConversation(
    from: string,
    to: string,
    deletedBy: string,
  ): Promise<{ deletedCount: number }> {
    // DEBUG: Descomentar para depurar problemas de eliminación
    // console.log(`🗑️ clearAllMessagesInConversation llamada con:`);
    // console.log(`   from: "${from}"`);
    // console.log(`   to: "${to}"`);
    // console.log(`   deletedBy: "${deletedBy}"`);

    // Eliminar mensajes en ambas direcciones (from -> to y to -> from)
    const result1 = await this.messageRepository.update(
      { from, to, isDeleted: false },
      { isDeleted: true, deletedAt: new Date(), deletedBy },
    );
    // console.log(`   Resultado dirección 1 (from->to): ${result1.affected} afectados`);

    const result2 = await this.messageRepository.update(
      { from: to, to: from, isDeleted: false },
      { isDeleted: true, deletedAt: new Date(), deletedBy },
    );
    // console.log(`   Resultado dirección 2 (to->from): ${result2.affected} afectados`);

    const totalDeleted = (result1.affected || 0) + (result2.affected || 0);
    // console.log(`   Total eliminados: ${totalDeleted}`);

    return { deletedCount: totalDeleted };
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

    // 🔥 Primero intentar búsqueda exacta
    let message = await this.messageRepository.findOne({
      where: { id: messageId, from: username },
    });

    // 🔥 Si no se encuentra, intentar búsqueda case-insensitive
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

      // 🔥 Actualizar campos multimedia si se proporcionan
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

  // 🔥 NUEVO: Obtener conteo de mensajes no leídos por usuario en una sala específica
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

      // 🔥 DEBUG: Mostrar algunos mensajes para entender el formato
      if (messages.length > 0) {
        // console.log(`📊 DEBUG - Primeros 3 mensajes en sala ${roomCode}:`);
        // messages.slice(0, 3).forEach((msg, index) => {
        //   console.log(
        //     `  ${index + 1}. ID: ${msg.id}, From: "${msg.from}", ReadBy: ${JSON.stringify(msg.readBy)}`,
        //   );
        // });
      }

      // 🔥 RESOLVER ALIAS para asegurar que contamos correctamente
      const userAliases = await this.resolveUserAliases(username);
      const userAliasesLower = userAliases.map(a => a.toLowerCase().trim());

      // Contar mensajes que NO han sido leídos por el usuario
      const unreadCount = messages.filter((msg) => {
        // No contar mensajes propios
        const fromLower = msg.from?.toLowerCase().trim();
        if (userAliasesLower.includes(fromLower)) {
          return false;
        }

        // Si no tiene readBy o está vacío, no ha sido leído
        if (!msg.readBy || msg.readBy.length === 0) {
          return true;
        }

        // Verificar si el usuario está en la lista de lectores (usando alias)
        const isReadByUser = msg.readBy.some((reader) => {
          const rLower = reader?.toLowerCase().trim();
          return userAliasesLower.includes(rLower);
        });

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

  // 🔥 NUEVO: Obtener conteo de mensajes no leídos para múltiples salas
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

    // 🔥 RESOLVER ALIAS para buscar por todos los IDs del usuario
    const userAliases = await this.resolveUserAliases(username);

    // 🔥 Buscar mensajes donde el usuario participe (ya sea como from o to)
    const messages = await this.messageRepository.createQueryBuilder('message')
      .where('(message.from IN (:...aliases) OR message.to IN (:...aliases))', { aliases: userAliases })
      .andWhere('(message.message LIKE :search OR message.fileName LIKE :search)', { search: `%${searchTerm.trim()}%` })
      .andWhere('message.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('message.threadId IS NULL')
      .orderBy('message.sentAt', 'DESC')
      .take(limit)
      .getMany();

    const limitedResults = messages;

    // Retornar los mensajes con información de la conversación
    return limitedResults.map((msg) => {
      const result = {
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
        conversationType: msg.isGroup ? 'group' : 'direct',
        conversationId: msg.isGroup ? msg.roomCode : msg.to,
        conversationName: msg.isGroup ? msg.roomCode : msg.to,
      };
      return this.sanitizeMessage(result);
    });
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

  // Obtener mensajes de un hilo específico con información de paginación
  async findThreadMessages(
    threadId: number,
    limit: number = 100,
    offset: number = 0,
    order: 'ASC' | 'DESC' = 'ASC',
    attachmentId?: number, // 🔥 NUEVO: Filtrar por adjunto específico
  ): Promise<{ data: Message[]; total: number; hasMore: boolean; page: number; totalPages: number }> {
    // 🔥 CORREGIDO: Usar ID en lugar de sentAt para ordenamiento consistente
    // sentAt puede estar corrupto, así que usamos ID que es más confiable
    // 🔥 INCLUIR mensajes eliminados para mostrarlos como "Mensaje eliminado por..." en la UI
    const where: any = { threadId };
    if (attachmentId) {
      where.replyToAttachmentId = attachmentId;
    }

    const [messages, total] = await this.messageRepository.findAndCount({
      where,
      order: { id: order },
      take: limit,
      skip: offset,
    });

    // 🔥 Calcular información de paginación
    const page = Math.floor(offset / limit) + 1;
    const totalPages = Math.ceil(total / limit);
    const hasMore = offset + messages.length < total;

    // 🔥 Si ordenamos DESC, revertimos para mantener orden cronológico en el frontend
    const orderedMessages = order === 'DESC' ? messages.reverse() : messages;

    // 🔥 Enriquecer con fotos y metadatos
    const enrichedData = await this.enrichMessages(orderedMessages);

    return {
      data: enrichedData,
      total,
      hasMore,
      page,
      totalPages,
    };
  }


  // 🔥 NUEVO: Obtener mensajes de sala ANTES de un ID específico (para paginación hacia atrás con 'aroundMode')
  async findByRoomBeforeId(
    roomCode: string,
    beforeId: number,
    limit: number = 20,
  ): Promise<{ data: any[]; total: number; hasMore: boolean }> {
    const messages = await this.messageRepository
      .createQueryBuilder('message')
      .where('message.roomCode = :roomCode', { roomCode })
      .andWhere('message.id < :beforeId', { beforeId })
      .andWhere('message.threadId IS NULL') // 🔥 FIX: Solo mensajes principales
      .andWhere('message.isDeleted = false')
      .orderBy('message.id', 'DESC')
      .take(limit)
      .getMany();

    // Revertir para orden cronológico
    const orderedMessages = await this.enrichMessages(messages.reverse());

    return {
      data: orderedMessages,
      total: messages.length, // Total fetched in this batch
      hasMore: messages.length === limit,
    };
  }

  // 🔥 NUEVO: Obtener mensajes privados ANTES de un ID específico
  async findByUserBeforeId(
    from: string,
    to: string,
    beforeId: number,
    limit: number = 20,
  ): Promise<{ data: any[]; total: number; hasMore: boolean }> {
    const messages = await this.messageRepository
      .createQueryBuilder('message')
      .where(
        '((LOWER(message.from) = LOWER(:from) AND LOWER(message.to) = LOWER(:to)) OR (LOWER(message.from) = LOWER(:to) AND LOWER(message.to) = LOWER(:from)))',
        { from, to }
      )
      .andWhere('message.id < :beforeId', { beforeId })
      .andWhere('message.threadId IS NULL') // 🔥 FIX: Solo mensajes principales
      .andWhere('message.isDeleted = false')
      .orderBy('message.id', 'DESC')
      .take(limit)
      .getMany();

    const orderedMessages = await this.enrichMessages(messages.reverse());

    return {
      data: orderedMessages,
      total: messages.length,
      hasMore: messages.length === limit,
    };
  }

  // 🔥 NUEVO: Obtener mensajes de sala DESPUÉS de un ID específico (para cargando hacia adelante)
  async findByRoomAfterId(
    roomCode: string,
    afterId: number,
    limit: number = 20,
  ): Promise<{ data: any[]; total: number; hasMore: boolean }> {
    const messages = await this.messageRepository
      .createQueryBuilder('message')
      .where('message.roomCode = :roomCode', { roomCode })
      .andWhere('message.id > :afterId', { afterId })
      .andWhere('message.threadId IS NULL') // 🔥 FIX: Solo mensajes principales
      .andWhere('message.isDeleted = false')
      .orderBy('message.id', 'ASC') // Orden ascendente (más viejos primero dentro del rango "futuro")
      .take(limit)
      .getMany();

    // No revertir, ya vienen en orden cronológico (ASC)
    const orderedMessages = await this.enrichMessages(messages);

    orderedMessages.forEach((msg) => {
      msg.time = formatPeruTime(new Date(msg.sentAt));
    });

    return {
      data: orderedMessages,
      total: messages.length,
      hasMore: messages.length === limit,
    };
  }

  // 🔥 NUEVO: Obtener mensajes privados DESPUÉS de un ID específico
  async findByUserAfterId(
    from: string,
    to: string,
    afterId: number,
    limit: number = 20,
  ): Promise<{ data: any[]; total: number; hasMore: boolean }> {
    const messages = await this.messageRepository
      .createQueryBuilder('message')
      .where(
        '((LOWER(message.from) = LOWER(:from) AND LOWER(message.to) = LOWER(:to)) OR (LOWER(message.from) = LOWER(:to) AND LOWER(message.to) = LOWER(:from)))',
        { from, to }
      )
      .andWhere('message.id > :afterId', { afterId })
      .andWhere('message.threadId IS NULL') // 🔥 FIX: Solo mensajes principales
      .andWhere('message.isDeleted = false')
      .orderBy('message.id', 'ASC')
      .take(limit)
      .getMany();

    const orderedMessages = await this.enrichMessages(messages);

    orderedMessages.forEach((msg) => {
      msg.time = formatPeruTime(new Date(msg.sentAt));
    });

    return {
      data: orderedMessages,
      total: messages.length,
      hasMore: messages.length === limit,
    };
  }

  // 🚀 OPTIMIZADO: Incrementar contador de respuestas en hilo con UPDATE directo
  // 🔥 FIX: Separar contadores - General vs Adjunto específico
  async incrementThreadCount(messageId: number, attachmentId?: number): Promise<void> {
    if (attachmentId) {
      // Si es respuesta a un adjunto específico, SOLO incrementar el contador del adjunto
      await this.attachmentRepository.increment({ id: attachmentId }, 'threadCount', 1);
    } else {
      // Si es respuesta general (sin adjunto), SOLO incrementar el contador del mensaje padre
      await this.messageRepository.increment({ id: messageId }, 'threadCount', 1);
    }
  }

  // 🔥 NUEVO: Obtener hilos padres de un grupo (roomCode)
  // 🔥 NUEVO: Obtener hilos padres de un grupo (roomCode)
  async findThreadsByRoom(
    roomCode: string,
    limit: number = 50,
    offset: number = 0,
    search: string = '', // 🔥 Filtro de búsqueda
  ): Promise<{ data: any[]; total: number; hasMore: boolean }> {

    const whereCondition: any = {
      roomCode,
      threadId: IsNull(), // Solo mensajes principales (no respuestas)
      isDeleted: false,
      threadCount: MoreThan(0), // 🔥 Filtrar desde BD los que tienen hilos
    };

    if (search && search.trim()) {
      whereCondition.message = Like(`%${search.trim()}%`);
    }

    const [threads, total] = await this.messageRepository.findAndCount({
      where: whereCondition,
      order: { id: 'DESC' }, // Más recientes primero
      take: limit, // 🔥 Paginación DB
      skip: offset, // 🔥 Paginación DB
    });

    const data = threads.map((msg) => ({
      id: msg.id,
      message: msg.message,
      from: msg.from,
      senderRole: msg.senderRole,
      senderNumeroAgente: msg.senderNumeroAgente,
      threadCount: msg.threadCount,
      lastReplyFrom: msg.lastReplyFrom,
      sentAt: msg.sentAt,
      mediaType: msg.mediaType,
      roomCode: msg.roomCode,
    }));

    return {
      data,
      total,
      hasMore: offset + threads.length < total,
    };
  }

  // 🔥 NUEVO: Obtener hilos padres de un chat directo (from/to)
  async findThreadsByUser(
    from: string,
    to: string,
    limit: number = 50,
    offset: number = 0,
    search: string = '', // 🔥 Filtro de búsqueda
  ): Promise<{ data: any[]; total: number; hasMore: boolean }> {

    // 🔥 RESOLVER ALIAS
    const fromAliases = await this.resolveUserAliases(from);
    const toAliases = await this.resolveUserAliases(to);

    const queryBuilder = this.messageRepository
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.attachments', 'attachments')
      .where(
        '((message.from IN (:...fromAliases) AND message.to IN (:...toAliases)) OR (message.from IN (:...toAliases) AND message.to IN (:...fromAliases)))',
        { fromAliases, toAliases },
      )
      .andWhere('message.threadId IS NULL')
      .andWhere('message.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('message.threadCount > :threadCount', { threadCount: 0 });

    if (search && search.trim()) {
      queryBuilder.andWhere('message.message LIKE :search', { search: `%${search.trim()}%` });
    }

    // Buscar mensajes entre ambos usuarios (en ambas direcciones)
    const [threads, total] = await queryBuilder
      .orderBy('message.id', 'DESC')
      .take(limit)
      .skip(offset)
      .getManyAndCount();

    const data = threads.map((msg) => ({
      id: msg.id,
      message: msg.message,
      from: msg.from,
      senderRole: msg.senderRole,
      senderNumeroAgente: msg.senderNumeroAgente,
      threadCount: msg.threadCount,
      lastReplyFrom: msg.lastReplyFrom,
      sentAt: msg.sentAt,
      mediaType: msg.mediaType,
      roomCode: msg.roomCode, // Puede ser null en privados
    }));

    return {
      data,
      total,
      hasMore: offset + threads.length < total,
    };
  }

  // 🔥 NUEVO: Buscar mensaje de videollamada por videoRoomID
  async findByVideoRoomID(videoRoomID: string): Promise<Message | null> {
    return await this.messageRepository.findOne({
      where: { videoRoomID },
      order: { id: 'DESC' }, // Obtener el más reciente
    });
  }

  // 🔥 NUEVO: Fallback para mensajes antiguos sin videoRoomID
  // Buscar la última videollamada por roomCode
  async findLatestVideoCallByRoomCode(roomCode: string): Promise<Message | null> {
    return await this.messageRepository.findOne({
      where: { roomCode, type: 'video_call' },
      order: { id: 'DESC' },
    });
  }

  // 🔥 NUEVO: Actualizar mensaje
  async update(messageId: number, updateData: Partial<Message>): Promise<void> {
    await this.messageRepository.update(messageId, updateData);
  }

  // 🔥 NUEVO: Obtener mensajes alrededor de un messageId específico (para jump-to-message)
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

  // 🔥 NUEVO: Obtener mensajes alrededor de un messageId para chats individuales
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
    const message = await this.messageRepository.findOne({
      where: { id },
      relations: ['room'] // Opcional: si necesitas datos de la sala
    });
    return this.sanitizeMessage(message);
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

  // 🚀 NUEVO: Normalización para readBy - MAYÚSCULAS para compatibilidad
  // Los datos existentes ya están en MAYÚSCULAS, mantenemos el formato
  private normalizeForReadBy(username: string): string {
    return (
      username
        ?.toUpperCase()
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') || ''
    );
  }

  // 🔥 FIX: Resolver DNI → Nombre Completo para readBy
  // readBy históricamente guarda nombres completos (UPPERCASE).
  // Cuando el username es un DNI, buscamos el nombre completo en la BD.
  // Si no se encuentra, fallback al username original.
  private async resolveFullNameForReadBy(username: string): Promise<string> {
    if (!username) return username;
    try {
      const user = await this.userRepository.findOne({ where: { username } });
      if (user?.nombre && user?.apellido) {
        return `${user.nombre} ${user.apellido}`;
      }
    } catch (error) {
      console.error(`⚠️ resolveFullNameForReadBy error for ${username}:`, error);
    }
    return username; // Fallback: usar el username tal cual
  }

  // 🔥 NUEVO: Búsqueda global de mensajes (tipo WhatsApp) con paginación
  // Busca en mensajes que el usuario escribió, recibió, o de grupos donde participa
  async searchAllMessages(
    username: string,
    searchTerm: string,
    limit: number = 15,
    offset: number = 0,
  ): Promise<{
    results: any[];
    total: number;
    hasMore: boolean;
    nextOffset: number;
    groupedByConversation: { [key: string]: number };
  }> {
    if (!searchTerm || searchTerm.trim().length < 2) {
      return { results: [], total: 0, hasMore: false, nextOffset: 0, groupedByConversation: {} };
    }

    const searchLower = searchTerm.toLowerCase().trim();

    // 1. Obtener los roomCodes de los grupos donde el usuario participa
    const userRooms = await this.temporaryRoomRepository
      .createQueryBuilder('room')
      .where('room.isActive = :isActive', { isActive: true })
      .andWhere('room.members LIKE :memberPattern', {
        memberPattern: `%"${username}"%`,
      })
      .getMany();

    const userRoomCodes = userRooms.map((room) => room.roomCode);
    const roomCodeToName: { [key: string]: string } = {};
    const roomCodeToId: { [key: string]: number } = {};
    userRooms.forEach((room) => {
      roomCodeToName[room.roomCode] = room.name;
      roomCodeToId[room.roomCode] = room.id;
    });

    // 2. Query base para contar total
    const baseQuery = this.messageRepository
      .createQueryBuilder('msg')
      .where('msg.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('msg.threadId IS NULL')
      .andWhere(
        `(msg.message LIKE :searchPattern OR msg.fileName LIKE :searchPattern)`,
        { searchPattern: `%${searchLower}%` },
      )
      .andWhere(
        `(
          msg.from = :username
          OR msg.to = :username
          ${userRoomCodes.length > 0 ? 'OR msg.roomCode IN (:...roomCodes)' : ''}
        )`,
        {
          username,
          ...(userRoomCodes.length > 0 ? { roomCodes: userRoomCodes } : {}),
        },
      );

    // 3. Obtener total de resultados (solo en primera página para optimizar)
    let total = 0;
    let groupedByConversation: { [key: string]: number } = {};

    if (offset === 0) {
      // Solo calcular total y agrupación en la primera carga
      const allMatchingMessages = await baseQuery
        .clone()
        .orderBy('msg.sentAt', 'DESC')
        .getMany();

      total = allMatchingMessages.length;

      // Agrupar conteo por conversación
      allMatchingMessages.forEach((msg) => {
        const key = msg.isGroup || msg.roomCode
          ? roomCodeToName[msg.roomCode] || msg.roomCode
          : msg.from === username
            ? msg.to
            : msg.from;
        groupedByConversation[key] = (groupedByConversation[key] || 0) + 1;
      });
    }

    // 4. Buscar mensajes paginados
    const messages = await baseQuery
      .clone()
      .orderBy('msg.sentAt', 'DESC')
      .skip(offset)
      .take(limit + 1) // +1 para saber si hay más
      .getMany();

    const hasMore = messages.length > limit;
    const paginatedMessages = messages.slice(0, limit);

    // 5. Mapear resultados con información para navegación
    const results = paginatedMessages.map((msg) => {
      const isGroup = msg.isGroup || !!msg.roomCode;
      let conversationId: string;
      let conversationName: string;
      let chatId: number | null = null;

      if (isGroup) {
        conversationId = msg.roomCode;
        conversationName = roomCodeToName[msg.roomCode] || msg.roomCode;
        chatId = roomCodeToId[msg.roomCode] || null;
      } else {
        const otherUser = msg.from === username ? msg.to : msg.from;
        conversationId = otherUser;
        conversationName = otherUser;
      }

      return {
        id: msg.id,
        message: msg.message,
        from: msg.from,
        to: msg.to,
        sentAt: msg.sentAt,
        time: msg.time,
        mediaType: msg.mediaType,
        fileName: msg.fileName,
        conversationType: isGroup ? 'group' : 'direct',
        conversationId,
        conversationName,
        roomCode: msg.roomCode,
        chatId,
        isMyMessage: msg.from === username,
        highlightText: this.getHighlightedText(msg.message, searchTerm),
      };
    });

    return {
      results,
      total: offset === 0 ? total : -1, // -1 indica que no se recalculó
      hasMore,
      nextOffset: offset + limit,
      groupedByConversation: offset === 0 ? groupedByConversation : {},
    };
  }

  // Helper para resaltar el texto encontrado
  private getHighlightedText(
    text: string,
    searchTerm: string,
  ): string | null {
    if (!text) return null;
    const index = text.toLowerCase().indexOf(searchTerm.toLowerCase());
    if (index === -1) return text.substring(0, 100);

    // Extraer contexto alrededor del match
    const start = Math.max(0, index - 20);
    const end = Math.min(text.length, index + searchTerm.length + 50);
    let excerpt = text.substring(start, end);

    if (start > 0) excerpt = '...' + excerpt;
    if (end < text.length) excerpt = excerpt + '...';

    return excerpt;
  }

  // 🔥 NUEVO: Cargar mensajes alrededor de un mensaje específico (para búsqueda tipo WhatsApp)
  async getMessagesAroundMessage(
    messageId: number,
    before: number = 25,
    after: number = 25,
  ): Promise<{
    messages: any[];
    targetMessageId: number;
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
    totalInConversation: number;
    conversationType: 'group' | 'direct';
    conversationId: string;
    oldestLoadedId: number | null;
    newestLoadedId: number | null;
  }> {
    // 1. Buscar el mensaje objetivo
    const targetMessage = await this.messageRepository.findOne({
      where: { id: messageId, isDeleted: false },
    });

    if (!targetMessage) {
      throw new Error(`Mensaje con ID ${messageId} no encontrado`);
    }

    const isGroup = targetMessage.isGroup || !!targetMessage.roomCode;
    let conversationId: string;
    let baseQuery = this.messageRepository
      .createQueryBuilder('msg')
      .where('msg.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('msg.threadId IS NULL'); // Solo mensajes principales

    // 2. Construir query según tipo de conversación
    if (isGroup) {
      conversationId = targetMessage.roomCode;
      baseQuery = baseQuery.andWhere('msg.roomCode = :roomCode', {
        roomCode: targetMessage.roomCode,
      });
    } else {
      // Chat directo: mensajes entre los dos usuarios
      const user1 = targetMessage.from;
      const user2 = targetMessage.to;
      conversationId = `${user1}-${user2}`;
      baseQuery = baseQuery.andWhere(
        `((msg.from = :user1 AND msg.to = :user2) OR (msg.from = :user2 AND msg.to = :user1))`,
        { user1, user2 },
      );
    }

    // 3. Obtener mensajes ANTES del mensaje objetivo
    const messagesBefore = await baseQuery
      .clone()
      .andWhere('msg.sentAt < :targetDate', { targetDate: targetMessage.sentAt })
      .orderBy('msg.sentAt', 'DESC')
      .take(before + 1) // +1 para saber si hay más
      .getMany();

    // 4. Obtener mensajes DESPUÉS del mensaje objetivo
    const messagesAfter = await baseQuery
      .clone()
      .andWhere('msg.sentAt > :targetDate', { targetDate: targetMessage.sentAt })
      .orderBy('msg.sentAt', 'ASC')
      .take(after + 1) // +1 para saber si hay más
      .getMany();

    // 5. Determinar si hay más mensajes
    const hasMoreBefore = messagesBefore.length > before;
    const hasMoreAfter = messagesAfter.length > after;

    // Recortar al límite solicitado
    const trimmedBefore = messagesBefore.slice(0, before).reverse(); // Revertir para orden cronológico
    const trimmedAfter = messagesAfter.slice(0, after);

    // 6. Combinar mensajes en orden cronológico
    const allMessages = [...trimmedBefore, targetMessage, ...trimmedAfter];

    // 7. Obtener total de mensajes en la conversación
    const totalInConversation = await baseQuery.clone().getCount();

    // 8. Enriquecer mensajes con thread info y formatear hora
    const messages = await this.enrichMessages(allMessages);

    messages.forEach((msg) => {
      msg.time = formatPeruTime(new Date(msg.sentAt));
    });

    return {
      messages,
      targetMessageId: messageId,
      hasMoreBefore,
      hasMoreAfter,
      totalInConversation,
      conversationType: isGroup ? 'group' : 'direct',
      conversationId,
      oldestLoadedId: messages.length > 0 ? messages[0].id : null,
      newestLoadedId: messages.length > 0 ? messages[messages.length - 1].id : null,
    };
  }

  // 🔥 HELPER: Enriquecer mensajes con información de hilos (respuestas) Y FOTOS
  private async enrichMessages(messages: any[]): Promise<any[]> {
    if (!messages || messages.length === 0) return [];

    const messageIds = messages.map((m) => m.id);
    const threadCountMap: Record<number, number> = {};
    const lastReplyMap: Record<number, string> = {};
    const lastReplyTextMap: Record<number, string> = {};

    // 1. Thread Counts
    if (messageIds.length > 0) {
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

      // 2. Last Replies
      const lastReplies = await this.messageRepository
        .createQueryBuilder('message')
        .leftJoin(User, 'user', 'user.username = message.from')
        .select('message.threadId', 'threadId')
        .addSelect('message.from', 'from')
        .addSelect("COALESCE(CONCAT(user.nombre, ' ', user.apellido), message.from)", 'fromName')
        .addSelect(
          'CASE WHEN LENGTH(message.message) > 100 THEN CONCAT(SUBSTRING(message.message, 1, 100), "...") ELSE message.message END',
          'message',
        )
        .where('message.threadId IN (:...messageIds)', { messageIds })
        .andWhere('message.isDeleted = false')
        .orderBy('message.id', 'DESC')
        .getRawMany();

      // Group by threadId and take first (most recent)
      const seenThreadIds = new Set<number>();
      lastReplies.forEach((reply) => {
        if (!seenThreadIds.has(reply.threadId)) {
          lastReplyMap[reply.threadId] = reply.fromName || reply.from;
          lastReplyTextMap[reply.threadId] = reply.message || '';
          seenThreadIds.add(reply.threadId);
        }
      });
    }

    // 🔥 3. Obtener Adjuntos (Attachments) de forma masiva
    const attachmentsMap: Record<number, any[]> = {};
    if (messageIds.length > 0) {
      try {
        const allAttachments = await this.attachmentRepository.find({
          where: { messageId: In(messageIds) }
        });

        allAttachments.forEach(att => {
          if (!attachmentsMap[att.messageId]) {
            attachmentsMap[att.messageId] = [];
          }
          attachmentsMap[att.messageId].push(att);
        });
      } catch (err) {
        console.error('Error fetching attachments in enrichMessages:', err);
      }
    }

    // 🔥 4. Obtener fotos de perfil (cache + DB robusta)
    const uniqueSenders = [...new Set(messages.map(m => m.from))];
    const userMap: Record<string, string> = {};
    const missingUsernames: string[] = [];
    const now = Date.now();

    // Cache check
    uniqueSenders.forEach(username => {
      const cached = this.pictureCache.get(username);
      if (cached && cached.expiresAt > now) {
        userMap[username] = cached.url;
      } else {
        missingUsernames.push(username);
      }
    });

    // DB Fetch
    if (missingUsernames.length > 0) {
      try {
        const users = await this.userRepository
          .createQueryBuilder('user')
          .select(['user.username', 'user.nombre', 'user.apellido', 'user.picture'])
          .where('user.username IN (:...names)', { names: missingUsernames })
          .orWhere("CONCAT(COALESCE(user.nombre, ''), ' ', COALESCE(user.apellido, '')) IN (:...names)", { names: missingUsernames })
          .orWhere("CONCAT(COALESCE(user.nombre, ''), ' ', COALESCE(user.apellido, ''), ' ') IN (:...names)", { names: missingUsernames })
          .getMany();

        const fullNameMap: Record<string, string> = {};
        users.forEach(u => {
          const fullName = `${u.nombre || ''} ${u.apellido || ''}`.trim();
          if (fullName) {
            fullNameMap[u.username] = fullName;
          }

          if (u.picture) {
            const fullNameWithSpace = `${fullName} `;

            // Map back to requested keys
            if (missingUsernames.includes(u.username)) {
              userMap[u.username] = u.picture;
              this.pictureCache.set(u.username, { url: u.picture, expiresAt: now + this.PICTURE_CACHE_TTL });
            }
            if (missingUsernames.includes(fullName)) {
              userMap[fullName] = u.picture;
              this.pictureCache.set(fullName, { url: u.picture, expiresAt: now + this.PICTURE_CACHE_TTL });
            }
            if (missingUsernames.includes(fullNameWithSpace)) {
              userMap[fullNameWithSpace] = u.picture;
              this.pictureCache.set(fullNameWithSpace, { url: u.picture, expiresAt: now + this.PICTURE_CACHE_TTL });
            }
          }
        });
        (this as any)._currentBatchFullNameMap = fullNameMap;
      } catch (err) {
        console.error('Error fetching user pictures in enrichMessages:', err);
      }
    }

    // 4. Map messages & Return
    const batchFullNameMap = (this as any)._currentBatchFullNameMap || {};

    return messages.map((msg) => {
      // Asegurar que msg es un objeto plano si es una entidad
      const msgObj = typeof msg.toJSON === 'function' ? msg.toJSON() : msg;

      // Intentar resolver el nombre completo del remitente
      const resolvedFromName = batchFullNameMap[msg.from] || msg.from;

      const enrichedMsg = {
        ...msgObj,
        from: resolvedFromName, // 🔥 Ahora el 'from' trae el nombre completo si está disponible
        threadCount: threadCountMap[msg.id] || 0,
        lastReplyFrom: lastReplyMap[msg.id] || null,
        lastReplyText: lastReplyTextMap[msg.id] || null,
        attachments: attachmentsMap[msg.id] || msg.attachments || [],
        picture: userMap[msg.from] || userMap[resolvedFromName] || null,
      };

      return this.sanitizeMessage(enrichedMsg);
    });
  }
}
