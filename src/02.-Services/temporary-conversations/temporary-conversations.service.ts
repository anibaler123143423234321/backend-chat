import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not, Like } from 'typeorm';
import { TemporaryConversation } from 'src/02.-Services/temporary-conversations/entities/temporary-conversation.entity';
import { CreateTemporaryConversationDto } from 'src/02.-Services/temporary-conversations/dto/create-temporary-conversation.dto';
import { Message } from 'src/02.-Services/messages/entities/message.entity';
import { User } from 'src/02.-Services/users/entities/user.entity'; //  Importar entidad User
import { randomBytes } from 'crypto';

@Injectable()
export class TemporaryConversationsService {
  constructor(
    @InjectRepository(TemporaryConversation)
    private temporaryConversationRepository: Repository<TemporaryConversation>,
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    @InjectRepository(User) // 🔥 Inyectar repositorio de User
    private userRepository: Repository<User>,
  ) { }

  async create(
    createDto: CreateTemporaryConversationDto,
    userId: number,
  ): Promise<TemporaryConversation> {
    const linkId = this.generateLinkId();

    const conversation = this.temporaryConversationRepository.create({
      ...createDto,
      linkId,
      createdBy: userId,
      currentParticipants: 0,
      isActive: true,
    });

    return await this.temporaryConversationRepository.save(conversation);
  }

  async findAll(
    username?: string,
    role?: string,
    search?: string,
    search2?: string,
    page: number = 1,
    limit: number = 20,
    status?: string,
  ): Promise<{
    data: any[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    // Build where condition based on status filter
    const whereCondition: any = {};
    if (status === 'inactive') {
      whereCondition.isActive = false;
    } else if (status === 'all') {
      // No isActive filter — show everything
    } else {
      // Default: only active
      whereCondition.isActive = true;
    }

    const allConversations = await this.temporaryConversationRepository.find({
      where: whereCondition,
      order: { createdAt: 'DESC' },
    });

    // Normalizar username para comparación (remover acentos y convertir a minúsculas)
    const usernameNormalized = this.normalizeUsername(username);

    // 🔥 ROLES que pueden ver TODAS las conversaciones (sin filtrar por participante)
    const adminRoles = ['SUPERADMIN', 'ADMIN', 'PROGRAMADOR', 'DESARROLLADOR', 'JEFEPISO'];
    const isAdminRole = role && adminRoles.includes(role.toUpperCase());

    // Filtrar conversaciones: Si es admin, mostrar todas. Si no, solo las del usuario
    let conversationsToEnrich = allConversations;
    if (!isAdminRole && username && usernameNormalized) {
      // Solo filtrar si NO es admin
      conversationsToEnrich = allConversations.filter((conv) => {
        const participants = conv.participants || [];
        const isParticipant = participants.some(
          (p) => this.normalizeUsername(p) === usernameNormalized,
        );
        return isParticipant;
      });
    }

    // 🔥 BÚSQUEDA: Filtrar por cada palabra clave ingresada (permite buscar "Usuario1 Usuario2")
    const combinedSearch = `${search || ''} ${search2 || ''}`.trim();
    if (combinedSearch) {
      const searchTerms = this.normalizeUsername(combinedSearch).split(/\s+/).filter((word) => word.length > 0);

      conversationsToEnrich = conversationsToEnrich.filter((conv) => {
        const convNameNormalized = this.normalizeUsername(conv.name || '');
        const participantsNormalized = (conv.participants || []).map((p) =>
          this.normalizeUsername(p),
        );

        // Para que la conversación pase el filtro, DEBE coincidir con TODOS los términos (búsqueda AND)
        return searchTerms.every((term) => {
          const nameMatch = convNameNormalized.includes(term);
          const participantMatch = participantsNormalized.some((p) => p.includes(term));
          return nameMatch || participantMatch;
        });
      });
    }

    // 🔥 PAGINACIÓN: Calcular total antes de paginar
    const total = conversationsToEnrich.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;

    // Aplicar paginación
    const paginatedConversations = conversationsToEnrich.slice(offset, offset + limit);

    // Enriquecer cada conversación con el último mensaje y contador de no leídos
    const enrichedConversations = await Promise.all(
      paginatedConversations.map(async (conv) => {
        const participants = conv.participants || [];

        let lastMessage = null;
        let unreadCount = 0;

        if (participants.length >= 2) {
          // Obtener el último mensaje usando conversationId
          const messages = await this.messageRepository.find({
            where: {
              conversationId: conv.id,
              isDeleted: false,
              threadId: IsNull(),
              isGroup: false,
            },
            order: { sentAt: 'DESC' },
            take: 1,
          });

          if (messages.length > 0) {
            // Calcular el threadCount del último mensaje
            const threadCount = await this.messageRepository.count({
              where: { threadId: messages[0].id, isDeleted: false },
            });

            // Obtener el último mensaje del hilo (si existe)
            let lastReplyFrom = null;
            if (threadCount > 0) {
              const lastThreadMessage = await this.messageRepository.findOne({
                where: { threadId: messages[0].id, isDeleted: false },
                order: { sentAt: 'DESC' },
              });
              if (lastThreadMessage) {
                lastReplyFrom = lastThreadMessage.from;
              }
            }

            // Si es un archivo multimedia sin texto, mostrar el tipo de archivo
            let messageText = messages[0].message;
            if (!messageText && messages[0].mediaType) {
              const mediaTypeMap = {
                image: '📷 Imagen',
                video: '🎬 Video',
                audio: '🎵 Audio',
                document: '📄 Documento',
              };
              messageText =
                mediaTypeMap[messages[0].mediaType] || '📎 Archivo';
            }

            lastMessage = {
              id: messages[0].id,
              text: messageText,
              from: messages[0].from,
              to: messages[0].to,
              sentAt: messages[0].sentAt,
              mediaType: messages[0].mediaType,
              threadCount,
              lastReplyFrom,
            };
          }

          // Contar solo mensajes no leídos usando conversationId
          if (username && usernameNormalized) {
            const isUserParticipant = participants.some(
              (p) => this.normalizeUsername(p) === usernameNormalized,
            );

            if (isUserParticipant) {
              const allMessages = await this.messageRepository.find({
                where: {
                  conversationId: conv.id,
                  isDeleted: false,
                  threadId: IsNull(),
                  isGroup: false,
                },
              });

              unreadCount = allMessages.filter((msg) => {
                if (this.normalizeUsername(msg.from) === usernameNormalized) {
                  return false;
                }
                if (!msg.readBy || msg.readBy.length === 0) {
                  return true;
                }
                const isReadByUser = msg.readBy.some(
                  (reader) =>
                    this.normalizeUsername(reader) === usernameNormalized,
                );
                return !isReadByUser;
              }).length;
            } else {
              unreadCount = 0;
            }
          } else {
            const allMessages = await this.messageRepository.find({
              where: {
                conversationId: conv.id,
                isDeleted: false,
                threadId: IsNull(),
                isGroup: false,
              },
            });
            unreadCount = allMessages.filter((msg) => !msg.isRead).length;
          }
        }

        // Obtener información de los participantes
        let participantRole = null;
        let participantNumeroAgente = null;

        if (participants.length > 0) {
          const participantName = participants[0];
          const participantUser = await this.userRepository.findOne({
            where: { username: participantName },
          });

          if (participantUser) {
            participantRole = participantUser.role;
            participantNumeroAgente = participantUser.numeroAgente;
          }
        }

        return {
          ...conv,
          _lastMessageSentAt: lastMessage?.sentAt,
          unreadCount,
          role: participantRole,
          numeroAgente: participantNumeroAgente,
        };
      }),
    );

    // Ordenar por último mensaje (más reciente primero)
    enrichedConversations.sort((a, b) => {
      const aTime = (a as any)._lastMessageSentAt;
      const bTime = (b as any)._lastMessageSentAt;
      if (!aTime && !bTime) return 0;
      if (!aTime) return 1;
      if (!bTime) return -1;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });

    // Eliminar campo temporal antes de devolver
    const data = enrichedConversations.map(({ _lastMessageSentAt, ...rest }: any) => rest);

    return {
      data,
      total,
      page,
      totalPages,
    };
  }

  // 🔥 NUEVO: Método con paginación para conversaciones asignadas
  async findAssignedConversations(
    username?: string,
    page: number = 1,
    limit: number = 10,
    search?: string, // 🔥 NUEVO: Parámetro de búsqueda
  ): Promise<{
    conversations: any[];
    total: number;
    page: number;
    totalPages: number;
    hasMore: boolean;
  }> {
    // Normalizar username para comparación
    const usernameNormalized = this.normalizeUsername(username);
    // Log eliminado para optimización

    // 1. Construir QueryBuilder base
    const queryBuilder = this.temporaryConversationRepository
      .createQueryBuilder('conv')
      .where('conv.isActive = :isActive', { isActive: true });

    // 2. Filtrar por pertenencia (Sintaxis MySQL JSON_CONTAINS)
    if (username) {
      // 🚀 MODIFICADO: Usar LIKE para mayor flexibilidad con case-sensitivity y displayNames
      queryBuilder.andWhere('conv.participants LIKE :pattern', {
        pattern: `%${username}%`,
      });

      // 3. Excluir favoritos directamente en SQL
      // 🔥 FIX: Usar subquery con EXISTS para evitar duplicados
      queryBuilder.andWhere(
        `NOT EXISTS (
          SELECT 1 FROM conversation_favorites cf 
          WHERE cf.conversationId = conv.id 
          AND cf.username = :favUser
        )`,
        { favUser: username }
      );
    }

    // 4. Aplicar búsqueda
    if (search && search.trim()) {
      queryBuilder.andWhere(
        '(conv.name LIKE :search OR conv.participants LIKE :search)',
        {
          search: `%${search}%`
        },
      );
    }

    // 5. Ordenar, paginar y ejecutar
    queryBuilder.orderBy('conv.createdAt', 'DESC');

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const offset = (pageNum - 1) * limitNum;

    const [paginatedConversations, total] = await queryBuilder
      .skip(offset)
      .take(limitNum)
      .getManyAndCount();

    const totalPages = Math.ceil(total / limitNum);
    const hasMore = pageNum < totalPages;

    // 🔥 OPTIMIZADO: Procesar enriquecimiento con concurrencia controlada
    // Usar chunks de 5 para no saturar las 12 conexiones disponibles
    const enrichedConversations = [];
    const chunkSize = 5;

    for (let i = 0; i < paginatedConversations.length; i += chunkSize) {
      const chunk = paginatedConversations.slice(i, i + chunkSize);
      const enrichedChunk = await Promise.all(
        chunk.map(async (conv) => {
          const participants = conv.participants || [];
          let unreadCount = 0;
          let lastMessage = null;

          try {
            if (participants.length >= 2 && username && usernameNormalized) {
              const otherParticipants = participants.filter(
                (p) => this.normalizeUsername(p) !== usernameNormalized,
              );

              if (otherParticipants.length > 0) {
                // 🔥 SQL OPTIMIZATION: Usar count() directo en DB
                const qb = this.messageRepository.createQueryBuilder('msg');
                unreadCount = await qb
                  .where('msg.to = :me', { me: username })
                  .andWhere('msg.from IN (:...others)', { others: otherParticipants })
                  .andWhere('msg.isDeleted = :isDeleted', { isDeleted: false })
                  .andWhere('msg.threadId IS NULL')
                  .andWhere('msg.isGroup = :isGroup', { isGroup: false })
                  .andWhere('NOT JSON_CONTAINS(COALESCE(msg.readBy, "[]"), :meJson)', {
                    meJson: JSON.stringify(usernameNormalized),
                  })
                  .getCount();
              }

              // 🔥 Obtener último mensaje para ordenamiento y display
              const lastMessages = await this.messageRepository.find({
                where: {
                  conversationId: conv.id,
                  isDeleted: false,
                  threadId: IsNull(),
                  isGroup: false,
                },
                order: { sentAt: 'DESC' },
                take: 1,
              });

              if (lastMessages.length > 0) {
                lastMessage = { sentAt: lastMessages[0].sentAt };
              }
            }
          } catch (error) {
            console.error(`Error al contar unread en conv ${conv.id}:`, error);
          }

          // 🔥 Obtener información del otro participante (solo imagen)
          let otherParticipantPicture = null;

          if (participants.length > 0 && username) {
            const others = participants.filter((p) => this.normalizeUsername(p) !== usernameNormalized);
            if (others.length > 0) {
              const otherUser = await this.userRepository.findOne({
                where: { username: others[0] },
                select: ['picture'],
              });

              if (otherUser) {
                otherParticipantPicture = otherUser.picture;
              }
            }
          }

          return {
            id: conv.id,
            name: conv.name,
            linkId: conv.linkId,
            participants: conv.participants,
            assignedUsers: conv.assignedUsers,
            settings: conv.settings,
            unreadCount,
            lastMessage,
            picture: otherParticipantPicture,
          };
        }),
      );
      enrichedConversations.push(...enrichedChunk);
    }

    // 🔥 Ordenar por último mensaje (más reciente primero)
    enrichedConversations.sort((a, b) => {
      const aTime = a.lastMessage?.sentAt;
      const bTime = b.lastMessage?.sentAt;
      if (!aTime && !bTime) return 0;
      if (!aTime) return 1;
      if (!bTime) return -1;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });

    return {
      conversations: enrichedConversations,
      total,
      page,
      totalPages,
      hasMore,
    };
  }

  // 🔥 Función para normalizar nombres (remover acentos y convertir a MAYÚSCULAS)
  private normalizeUsername(username: string): string {
    return (
      username
        ?.toUpperCase()
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') || ''
    );
  }

  async findByUser(username: string): Promise<any[]> {
    // Obtener todas las conversaciones activas y filtrar en memoria
    const allConversations = await this.temporaryConversationRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    // ?? MODIFICADO: Filtrar conversaciones donde el usuario est� en assignedUsers (normalizado)
    const usernameNormalized = this.normalizeUsername(username);
    // Log eliminado para optimizaci�n

    const userConversations = allConversations.filter((conv) => {
      if (!conv.assignedUsers) return false;
      const found = conv.assignedUsers.some((u) => {
        const uNormalized = this.normalizeUsername(u);
        const match = uNormalized === usernameNormalized;
        // Log eliminado para optimizaci�n
        return match;
      });
      return found;
    });

    // Enriquecer cada conversación con el último mensaje y contador de no leídos
    const enrichedConversations = await Promise.all(
      userConversations.map(async (conv) => {
        // Obtener los participantes de la conversación
        const participants = conv.participants || [];

        // Obtener el último mensaje de la conversación
        // Buscar mensajes entre cualquiera de los participantes
        let lastMessage = null;
        let unreadCount = 0;

        if (participants.length >= 2) {
          // Construir condiciones para buscar mensajes entre los participantes
          const messageConditions = [];

          for (let i = 0; i < participants.length; i++) {
            for (let j = i + 1; j < participants.length; j++) {
              messageConditions.push(
                {
                  from: participants[i],
                  to: participants[j],
                  isDeleted: false,
                  threadId: IsNull(),
                  isGroup: false,
                },
                {
                  from: participants[j],
                  to: participants[i],
                  isDeleted: false,
                  threadId: IsNull(),
                  isGroup: false,
                },
              );
            }
          }

          // Obtener el último mensaje
          const messages = await this.messageRepository.find({
            where: messageConditions,
            order: { sentAt: 'DESC' },
            take: 1,
          });

          if (messages.length > 0) {
            // Calcular el threadCount del último mensaje
            const threadCount = await this.messageRepository.count({
              where: { threadId: messages[0].id, isDeleted: false },
            });

            // Obtener el último mensaje del hilo (si existe)
            let lastReplyFrom = null;
            if (threadCount > 0) {
              const lastThreadMessage = await this.messageRepository.findOne({
                where: { threadId: messages[0].id, isDeleted: false },
                order: { sentAt: 'DESC' },
              });
              if (lastThreadMessage) {
                lastReplyFrom = lastThreadMessage.from;
              }
            }

            lastMessage = {
              id: messages[0].id,
              text: messages[0].message,
              from: messages[0].from,
              to: messages[0].to,
              sentAt: messages[0].sentAt,
              mediaType: messages[0].mediaType,
              threadCount,
              lastReplyFrom,
            };
          }

          // Contar mensajes no leídos (mensajes enviados por otros usuarios que el usuario actual no ha leído)
          // 🔥 Filtrar solo mensajes dirigidos al usuario actual (case-insensitive)
          const usernameNormalized = username?.toLowerCase().trim();
          const filteredConditions = messageConditions.filter(
            (cond) =>
              cond.to?.toLowerCase().trim() === usernameNormalized &&
              cond.from?.toLowerCase().trim() !== usernameNormalized,
          );

          // Filtrar solo los mensajes que no han sido leídos por el usuario actual
          const allMessages = await this.messageRepository.find({
            where: filteredConditions,
          });

          // 🔥 Filtrar mensajes no leídos (case-insensitive en readBy)
          unreadCount = allMessages.filter((msg) => {
            if (!msg.readBy || msg.readBy.length === 0) {
              return true; // No ha sido leído por nadie
            }
            // Verificar si el usuario actual está en readBy (case-insensitive)
            const isReadByUser = msg.readBy.some(
              (reader) => reader?.toLowerCase().trim() === usernameNormalized,
            );
            return !isReadByUser;
          }).length;
        }

        // 🔥 Obtener información del otro participante (role, numeroAgente y PICTURE)
        const otherParticipants = participants.filter((p) => p !== username);
        let otherParticipantRole = null;
        let otherParticipantNumeroAgente = null;
        let otherParticipantPicture = null;

        if (otherParticipants.length > 0) {
          // Buscar el otro participante en la tabla chat_users
          const otherParticipantName = otherParticipants[0];
          const otherUser = await this.userRepository.findOne({
            where: { username: otherParticipantName },
          });

          if (otherUser) {
            otherParticipantRole = otherUser.role;
            otherParticipantNumeroAgente = otherUser.numeroAgente;
            otherParticipantPicture = otherUser.picture;
          }
        }

        return {
          ...conv,
          unreadCount,
          role: otherParticipantRole, // 🔥 Incluir role del otro participante
          numeroAgente: otherParticipantNumeroAgente, // 🔥 Incluir numeroAgente del otro participante
          picture: otherParticipantPicture, // 🔥 Incluir picture del otro participante
        };
      }),
    );

    // Ordenar por último mensaje (más reciente primero)
    enrichedConversations.sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return enrichedConversations;
  }

  async findOne(id: number): Promise<TemporaryConversation> {
    const conversation = await this.temporaryConversationRepository.findOne({
      where: { id, isActive: true },
    });

    if (!conversation) {
      throw new NotFoundException('Conversación temporal no encontrada');
    }

    return conversation;
  }

  async findByLinkId(linkId: string): Promise<TemporaryConversation> {
    const conversation = await this.temporaryConversationRepository.findOne({
      where: { linkId, isActive: true },
    });

    if (!conversation) {
      throw new NotFoundException('Enlace de conversación no válido');
    }

    return conversation;
  }

  async joinConversation(
    linkId: string,
    username: string,
  ): Promise<TemporaryConversation> {
    const conversation = await this.findByLinkId(linkId);

    if (
      conversation.maxParticipants > 0 &&
      conversation.currentParticipants >= conversation.maxParticipants
    ) {
      throw new BadRequestException(
        'La conversación ha alcanzado el máximo de participantes',
      );
    }

    if (!conversation.participants) {
      conversation.participants = [];
    }

    if (!conversation.participants.includes(username)) {
      conversation.participants.push(username);
      conversation.currentParticipants = conversation.participants.length;
      await this.temporaryConversationRepository.save(conversation);
    }

    return conversation;
  }

  async createAdminAssignedConversation(
    user1: string,
    user2: string,
    name: string,
    adminId: number,
  ): Promise<TemporaryConversation> {
    // 🔥 NORMALIZAR: Asegurar que la comparación sea consistente
    const u1 = this.normalizeUsername(user1);
    const u2 = this.normalizeUsername(user2);

    // 🚀 VALIDAR: Verificar si ya existe una conversación entre estos usuarios (incluyendo INACTIVAS)
    const allAssignedConversations =
      await this.temporaryConversationRepository.find({
        where: { isAssignedByAdmin: true }, // Buscar en todas, activas o inactivas
      });

    // Buscar si existe una conversación con los mismos participantes (normalizados)
    let existingConversation = allAssignedConversations.find((conv) => {
      const participants = (conv.participants || []).map(p => this.normalizeUsername(p));
      return participants.includes(u1) && participants.includes(u2);
    });

    if (existingConversation) {
      // 🔥 Si ya existe pero está inactiva, REACTIVARLA en lugar de crear una nueva
      if (!existingConversation.isActive) {
        existingConversation.isActive = true;
        // Opcional: Actualizar el nombre si cambió
        if (name) existingConversation.name = name;
        await this.temporaryConversationRepository.save(existingConversation);
      }
      return existingConversation;
    }

    const linkId = this.generateLinkId();

    const conversation = this.temporaryConversationRepository.create({
      name,
      linkId,
      createdBy: adminId,
      currentParticipants: 2,
      maxParticipants: 2,
      isActive: true,
      isAssignedByAdmin: true,
      participants: [user1, user2],
      assignedUsers: [user1, user2],
    });

    const saved = await this.temporaryConversationRepository.save(conversation);

    return saved;
  }

  async update(
    id: number,
    updateData: { name?: string },
  ): Promise<TemporaryConversation> {
    const conversation = await this.findOne(id);

    if (updateData.name) {
      conversation.name = updateData.name;
    }

    return await this.temporaryConversationRepository.save(conversation);
  }

  async remove(id: number, userId?: number): Promise<void> {
    // Buscar la conversación sin filtrar por isActive para poder manejar conversaciones ya eliminadas
    const conversation = await this.temporaryConversationRepository.findOne({
      where: { id },
    });

    if (!conversation) {
      throw new NotFoundException('Conversación temporal no encontrada');
    }

    // Si ya está inactiva, no hacer nada (ya fue eliminada)
    if (!conversation.isActive) {
      return;
    }

    // Si se proporciona userId, validar permisos
    if (userId && conversation.createdBy !== userId) {
      throw new BadRequestException(
        'No tienes permisos para eliminar esta conversación',
      );
    }

    conversation.isActive = false;
    await this.temporaryConversationRepository.save(conversation);
  }

  async deactivateConversation(
    id: number,
    userId: number,
    userRole: string,
  ): Promise<TemporaryConversation> {
    // Si es ADMIN, JEFEPISO o PROGRAMADOR, puede desactivar cualquier conversación
    const isAdmin = ['ADMIN', 'JEFEPISO', 'PROGRAMADOR'].includes(userRole);

    // Primero buscar la conversación sin restricciones para ver si existe
    const conversationExists =
      await this.temporaryConversationRepository.findOne({
        where: { id },
      });

    if (!conversationExists) {
      throw new NotFoundException('Conversación no encontrada');
    }

    // Ahora verificar permisos
    const conversation = await this.temporaryConversationRepository.findOne({
      where: isAdmin ? { id } : { id, createdBy: userId },
    });

    if (!conversation) {
      throw new NotFoundException(
        'No tienes permisos para desactivar esta conversación',
      );
    }

    conversation.isActive = false;
    const updatedConversation =
      await this.temporaryConversationRepository.save(conversation);

    return updatedConversation;
  }

  async activateConversation(
    id: number,
    userId: number,
    userRole: string,
  ): Promise<TemporaryConversation> {
    // Si es ADMIN, JEFEPISO o PROGRAMADOR, puede activar cualquier conversación
    const isAdmin = ['ADMIN', 'JEFEPISO', 'PROGRAMADOR'].includes(userRole);

    const conversation = await this.temporaryConversationRepository.findOne({
      where: isAdmin ? { id } : { id, createdBy: userId },
    });

    if (!conversation) {
      throw new NotFoundException(
        'Conversación no encontrada o no tienes permisos',
      );
    }

    conversation.isActive = true;
    const updatedConversation =
      await this.temporaryConversationRepository.save(conversation);

    return updatedConversation;
  }

  // ?? NUEVO: Obtener conversaciones de monitoreo (conversaciones de otros usuarios) con paginaci�n
  async findMonitoringConversations(
    username?: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{
    data: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const allConversations = await this.temporaryConversationRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    // Normalizar username para comparaci�n
    const usernameNormalized = this.normalizeUsername(username);
    // console.log(
    // `?? findMonitoringConversations - Buscando conversaciones de monitoreo para: "${username}" (normalizado: "${usernameNormalized}")`,
    // );
    // console.log(
    // `  Total de conversaciones activas: ${allConversations.length}`,
    // );

    // ?? FILTRAR: Devolver conversaciones donde el usuario NO es participante
    let conversationsToEnrich = allConversations;
    if (username && usernameNormalized) {
      conversationsToEnrich = allConversations.filter((conv) => {
        const participants = conv.participants || [];
        const isParticipant = participants.some(
          (p) => this.normalizeUsername(p) === usernameNormalized,
        );
        if (!isParticipant) {
          // console.log(
          // `  ? Conversaci�n de monitoreo: "${conv.name}" - participants: ${JSON.stringify(participants)}`,
          // );
        }
        return !isParticipant; // Invertir la l�gica: queremos conversaciones donde NO es participante
      });
      // console.log(
      // `  Conversaciones de monitoreo filtradas: ${conversationsToEnrich.length}`,
      // );
    }

    // Calcular paginaci�n
    const total = conversationsToEnrich.length;
    const totalPages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;
    const paginatedConversations = conversationsToEnrich.slice(
      skip,
      skip + limit,
    );

    // Enriquecer cada conversaci�n con el �ltimo mensaje y contador de no le�dos
    const enrichedConversations = await Promise.all(
      paginatedConversations.map(async (conv) => {
        const participants = conv.participants || [];

        let lastMessage = null;
        let unreadCount = 0;

        if (participants.length >= 2) {
          // Construir condiciones para buscar mensajes entre los participantes
          const messageConditions = [];

          for (let i = 0; i < participants.length; i++) {
            for (let j = i + 1; j < participants.length; j++) {
              messageConditions.push(
                {
                  from: participants[i],
                  to: participants[j],
                  isDeleted: false,
                  threadId: IsNull(),
                  isGroup: false,
                },
                {
                  from: participants[j],
                  to: participants[i],
                  isDeleted: false,
                  threadId: IsNull(),
                  isGroup: false,
                },
              );
            }
          }

          // ?? CORREGIDO: Obtener el �ltimo mensaje ordenando por ID (no por sentAt que puede estar corrupto)
          const messages = await this.messageRepository.find({
            where: messageConditions,
            order: { id: 'DESC' },
            take: 1,
          });

          // console.log(`?? Monitoreo - Conversaci�n: ${conv.name}, Participantes: ${JSON.stringify(participants)}, �ltimo mensaje ID: ${messages[0]?.id}, Texto: "${messages[0]?.message?.substring(0, 50)}"`);

          if (messages.length > 0) {
            // Calcular el threadCount del �ltimo mensaje
            const threadCount = await this.messageRepository.count({
              where: { threadId: messages[0].id, isDeleted: false },
            });

            // Obtener el �ltimo mensaje del hilo (si existe)
            let lastReplyFrom = null;
            if (threadCount > 0) {
              const lastThreadMessage = await this.messageRepository.findOne({
                where: { threadId: messages[0].id, isDeleted: false },
                order: { sentAt: 'DESC' },
              });
              if (lastThreadMessage) {
                lastReplyFrom = lastThreadMessage.from;
              }
            }

            // Si es un archivo multimedia sin texto, mostrar el tipo de archivo
            let messageText = messages[0].message;
            if (!messageText && messages[0].mediaType) {
              const mediaTypeMap = {
                image: '?? Imagen',
                video: '?? Video',
                audio: '?? Audio',
                document: '?? Documento',
              };
              messageText = mediaTypeMap[messages[0].mediaType] || '?? Archivo';
            }

            lastMessage = {
              id: messages[0].id,
              text: messageText,
              from: messages[0].from,
              to: messages[0].to,
              sentAt: messages[0].sentAt,
              mediaType: messages[0].mediaType,
              threadCount,
              lastReplyFrom,
            };
          }

          // Para monitoreo, el contador de no le�dos siempre es 0
          unreadCount = 0;
        }

        // Obtener informaci�n de los participantes (role y numeroAgente)
        let participantRole = null;
        let participantNumeroAgente = null;

        if (participants.length > 0) {
          // Buscar el primer participante en la tabla chat_users
          const participantName = participants[0];
          const participantUser = await this.userRepository.findOne({
            where: { username: participantName },
          });

          if (participantUser) {
            participantRole = participantUser.role;
            participantNumeroAgente = participantUser.numeroAgente;
          }
        }

        return {
          ...conv,
          unreadCount,
          role: participantRole,
          numeroAgente: participantNumeroAgente,
        };
      }),
    );

    return {
      data: enrichedConversations,
      total,
      page,
      limit,
      totalPages,
    };
  }

  // 🔥 Silenciar conversación
  async muteConversation(id: number, username: string): Promise<any> {
    const conversation = await this.findOne(id);
    const usernameNormalized = this.normalizeUsername(username);

    if (!conversation.settings) {
      conversation.settings = {};
    }

    if (!conversation.settings.mutedUsers) {
      conversation.settings.mutedUsers = [];
    }

    if (!conversation.settings.mutedUsers.includes(usernameNormalized)) {
      conversation.settings.mutedUsers.push(usernameNormalized);
      await this.temporaryConversationRepository.save(conversation);
    }

    return { success: true, isMuted: true, id };
  }

  // 🔥 Activar notificaciones (Desilenciar)
  async unmuteConversation(id: number, username: string): Promise<any> {
    const conversation = await this.findOne(id);
    const usernameNormalized = this.normalizeUsername(username);

    if (conversation.settings && conversation.settings.mutedUsers) {
      conversation.settings.mutedUsers = conversation.settings.mutedUsers.filter(u => u !== usernameNormalized);
      await this.temporaryConversationRepository.save(conversation);
    }

    return { success: true, isMuted: false, id };
  }

  private generateLinkId(): string {
    return randomBytes(8).toString('hex').toUpperCase();
  }
}
