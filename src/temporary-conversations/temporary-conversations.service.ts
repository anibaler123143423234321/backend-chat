import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not, Like } from 'typeorm';
import { TemporaryConversation } from './entities/temporary-conversation.entity';
import { CreateTemporaryConversationDto } from './dto/create-temporary-conversation.dto';
import { Message } from '../messages/entities/message.entity';
import { User } from '../users/entities/user.entity'; // 🔥 Importar entidad User
import { randomBytes } from 'crypto';
import { getPeruDate } from '../utils/date.utils';

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
    const expiresAt = getPeruDate();
    expiresAt.setHours(expiresAt.getHours() + createDto.durationHours);

    const conversation = this.temporaryConversationRepository.create({
      ...createDto,
      linkId,
      expiresAt,
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
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    data: any[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const allConversations = await this.temporaryConversationRepository.find({
      where: { isActive: true },
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

    // 🔥 BÚSQUEDA: Filtrar por nombre o participantes si hay término de búsqueda
    if (search && search.trim()) {
      const searchNormalized = this.normalizeUsername(search);
      conversationsToEnrich = conversationsToEnrich.filter((conv) => {
        // Buscar en nombre de conversación
        const nameMatch = this.normalizeUsername(conv.name || '').includes(searchNormalized);
        // Buscar en participantes
        const participantMatch = (conv.participants || []).some((p) =>
          this.normalizeUsername(p).includes(searchNormalized),
        );
        return nameMatch || participantMatch;
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

    // Obtener todas las conversaciones activas primero para filtrar
    const allConversations = await this.temporaryConversationRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    // Filtrar conversaciones donde el usuario es participante
    let filteredConversations = allConversations;
    if (username && usernameNormalized) {
      filteredConversations = allConversations.filter((conv) => {
        const participants = conv.participants || [];
        return participants.some(
          (p) => this.normalizeUsername(p) === usernameNormalized,
        );
      });
    }

    // 🔥 NUEVO: Aplicar filtro de búsqueda por nombre o participantes
    if (search && search.trim()) {
      const searchNormalized = this.normalizeUsername(search);
      filteredConversations = filteredConversations.filter((conv) => {
        // Buscar en nombre de conversación
        const nameMatch = this.normalizeUsername(conv.name || '').includes(searchNormalized);
        // Buscar en participantes
        const participantMatch = (conv.participants || []).some((p) =>
          this.normalizeUsername(p).includes(searchNormalized),
        );
        return nameMatch || participantMatch;
      });
    }

    // Aplicar paginaci�n a las conversaciones filtradas
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const offset = (pageNum - 1) * limitNum;

    const total = filteredConversations.length;
    const paginatedConversations = filteredConversations.slice(
      offset,
      offset + limitNum,
    );
    const totalPages = Math.ceil(total / limit);
    const hasMore = page < totalPages;

    // Log eliminado para optimizaci�n

    // Enriquecer cada conversaci�n con el �ltimo mensaje y contador de no le�dos
    const enrichedConversations = await Promise.all(
      paginatedConversations.map(async (conv) => {
        const participants = conv.participants || [];

        let lastMessage = null;
        let unreadCount = 0;

        try {
          // Obtener el �ltimo mensaje de la conversaci�n
          // Para conversaciones asignadas, buscar mensajes entre los participantes
          const participants = conv.participants || [];

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

            const messages = await this.messageRepository.find({
              where: messageConditions,
              order: { sentAt: 'DESC' },
              take: 1,
            });

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
                messageText =
                  mediaTypeMap[messages[0].mediaType] || '?? Archivo';
              }

              lastMessage = {
                text: messageText || messages[0].fileName || 'Archivo',
                from: messages[0].from,
                sentAt: messages[0].sentAt,
                threadCount,
                lastReplyFrom,
              };
            }

            // Calcular mensajes no le�dos para el usuario actual
            if (username && usernameNormalized) {
              // Verificar si el usuario es participante de la conversacion
              const isUserParticipant = participants.some(
                (p) => this.normalizeUsername(p) === usernameNormalized,
              );

              if (isUserParticipant) {
                // Si es participante, contar mensajes no leidos dirigidos a el
                const filteredConditions = messageConditions.filter(
                  (cond) =>
                    this.normalizeUsername(cond.to) === usernameNormalized &&
                    this.normalizeUsername(cond.from) !== usernameNormalized,
                );

                const allMessages = await this.messageRepository.find({
                  where: filteredConditions,
                });

                // Filtrar mensajes no leidos (normalizado en readBy)
                unreadCount = allMessages.filter((msg) => {
                  if (!msg.readBy || msg.readBy.length === 0) {
                    return true; // No ha sido leido por nadie
                  }
                  // Verificar si el usuario actual esta en readBy (normalizado)
                  const isReadByUser = msg.readBy.some(
                    (reader) =>
                      this.normalizeUsername(reader) === usernameNormalized,
                  );
                  return !isReadByUser;
                }).length;
              } else {
                // Si NO es participante (monitoreo), el contador siempre es 0
                unreadCount = 0;
              }
            }
          } else {
            // Si no hay participantes suficientes, no hay mensajes
            lastMessage = null;
            unreadCount = 0;
          }
        } catch (error) {
          console.error(`Error al enriquecer conversaci�n ${conv.id}:`, error);
        }

        return {
          ...conv,
          unreadCount,
        };
      }),
    );

    return {
      conversations: enrichedConversations,
      total,
      page,
      totalPages,
      hasMore,
    };
  }

  // ?? Funci�n para normalizar nombres (remover acentos y convertir a min�sculas)
  private normalizeUsername(username: string): string {
    return (
      username
        ?.toLowerCase()
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

        // 🔥 Obtener información del otro participante (role y numeroAgente)
        const otherParticipants = participants.filter((p) => p !== username);
        let otherParticipantRole = null;
        let otherParticipantNumeroAgente = null;

        if (otherParticipants.length > 0) {
          // Buscar el otro participante en la tabla chat_users
          const otherParticipantName = otherParticipants[0];
          const otherUser = await this.userRepository.findOne({
            where: { username: otherParticipantName },
          });

          if (otherUser) {
            otherParticipantRole = otherUser.role;
            otherParticipantNumeroAgente = otherUser.numeroAgente;
          }
        }

        return {
          ...conv,
          unreadCount,
          role: otherParticipantRole, // 🔥 Incluir role del otro participante
          numeroAgente: otherParticipantNumeroAgente, // 🔥 Incluir numeroAgente del otro participante
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

    if (new Date() > conversation.expiresAt) {
      throw new BadRequestException('La conversación ha expirado');
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
    // ?? VALIDAR: Verificar si ya existe una conversaci�n activa entre estos usuarios
    const allAssignedConversations =
      await this.temporaryConversationRepository.find({
        where: { isActive: true, isAssignedByAdmin: true },
      });

    // Buscar si existe una conversaci�n con los mismos participantes
    const existingConversation = allAssignedConversations.find((conv) => {
      const participants = conv.participants || [];
      // Verificar si ambos usuarios est�n en los participantes
      return participants.includes(user1) && participants.includes(user2);
    });

    if (existingConversation) {
      // Retornar la conversaci�n existente en lugar de crear una nueva
      // console.log(
      // `?? Conversaci�n duplicada detectada entre ${user1} y ${user2}. Retornando existente.`,
      // );
      return existingConversation;
    }

    const linkId = this.generateLinkId();
    const expiresAt = getPeruDate();
    // Conversaciones asignadas por admin no expiran (o expiran en 1 año)
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const conversation = this.temporaryConversationRepository.create({
      name,
      linkId,
      expiresAt,
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
    updateData: { name?: string; expiresAt?: Date },
  ): Promise<TemporaryConversation> {
    const conversation = await this.findOne(id);

    if (updateData.name) {
      conversation.name = updateData.name;
    }

    if (updateData.expiresAt) {
      conversation.expiresAt = new Date(updateData.expiresAt);
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

  private generateLinkId(): string {
    return randomBytes(8).toString('hex').toUpperCase();
  }
}
