import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { TemporaryConversation } from './entities/temporary-conversation.entity';
import { CreateTemporaryConversationDto } from './dto/create-temporary-conversation.dto';
import { Message } from '../messages/entities/message.entity';
import { User } from '../users/entities/user.entity'; // ðŸ”¥ Importar entidad User
import { randomBytes } from 'crypto';
import { getPeruDate } from '../utils/date.utils';

@Injectable()
export class TemporaryConversationsService {
  constructor(
    @InjectRepository(TemporaryConversation)
    private temporaryConversationRepository: Repository<TemporaryConversation>,
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    @InjectRepository(User) // ðŸ”¥ Inyectar repositorio de User
    private userRepository: Repository<User>,
  ) {}

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

  async findAll(username?: string): Promise<any[]> {
    const allConversations = await this.temporaryConversationRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    // Normalizar username para comparación (remover acentos y convertir a minúsculas)
    const usernameNormalized = this.normalizeUsername(username);
    console.log(`🔍 findAll - Buscando conversaciones para: "${username}" (normalizado: "${usernameNormalized}")`);
    console.log(`  Total de conversaciones activas: ${allConversations.length}`);

    // 🔥 FILTRAR: Si hay username, solo devolver conversaciones donde el usuario es participante
    let conversationsToEnrich = allConversations;
    if (username && usernameNormalized) {
      conversationsToEnrich = allConversations.filter(conv => {
        const participants = conv.participants || [];
        const isParticipant = participants.some(p =>
          this.normalizeUsername(p) === usernameNormalized
        );
        if (isParticipant) {
          console.log(`  ✓ Conversación incluida: "${conv.name}" - participants: ${JSON.stringify(participants)}`);
        }
        return isParticipant;
      });
      console.log(`  Conversaciones filtradas: ${conversationsToEnrich.length}`);
    }

    // Enriquecer cada conversaciÃ³n con el Ãºltimo mensaje y contador de no leÃ­dos
    const enrichedConversations = await Promise.all(
      conversationsToEnrich.map(async (conv) => {
        const participants = conv.participants || [];

        let lastMessage = null;
        let unreadCount = 0;

        if (participants.length >= 2) {
          // Construir condiciones para buscar mensajes entre los participantes
          const messageConditions = [];

          for (let i = 0; i < participants.length; i++) {
            for (let j = i + 1; j < participants.length; j++) {
              messageConditions.push(
                { from: participants[i], to: participants[j], isDeleted: false, threadId: IsNull(), isGroup: false },
                { from: participants[j], to: participants[i], isDeleted: false, threadId: IsNull(), isGroup: false }
              );
            }
          }

          // Obtener el Ãºltimo mensaje
          const messages = await this.messageRepository.find({
            where: messageConditions,
            order: { sentAt: 'DESC' },
            take: 1,
          });

          if (messages.length > 0) {
            // Calcular el threadCount del Ãºltimo mensaje
            const threadCount = await this.messageRepository.count({
              where: { threadId: messages[0].id, isDeleted: false },
            });

            // Obtener el Ãºltimo mensaje del hilo (si existe)
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

            // ðŸ”¥ Si es un archivo multimedia sin texto, mostrar el tipo de archivo
            let messageText = messages[0].message;
            if (!messageText && messages[0].mediaType) {
              const mediaTypeMap = {
                'image': 'ðŸ“· Imagen',
                'video': 'ðŸŽ¥ Video',
                'audio': 'ðŸŽµ Audio',
                'document': 'ðŸ“„ Documento'
              };
              messageText = mediaTypeMap[messages[0].mediaType] || 'ðŸ“Ž Archivo';
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

          // ðŸ”¥ NUEVO: Contar solo mensajes no leÃ­dos dirigidos al usuario actual
          if (username && usernameNormalized) {
            // Verificar si el usuario es participante de la conversacion
            const isUserParticipant = participants.some(p =>
              this.normalizeUsername(p) === usernameNormalized
            );

            if (isUserParticipant) {
              // Si es participante, contar mensajes no leidos dirigidos a el
              const filteredConditions = messageConditions.filter(
                cond => this.normalizeUsername(cond.to) === usernameNormalized &&
                        this.normalizeUsername(cond.from) !== usernameNormalized
              );

              const allMessages = await this.messageRepository.find({
                where: filteredConditions,
              });

              // Filtrar mensajes no leidos (normalizado en readBy)
              unreadCount = allMessages.filter(msg => {
                if (!msg.readBy || msg.readBy.length === 0) {
                  return true; // No ha sido leido por nadie
                }
                // Verificar si el usuario actual esta en readBy (normalizado)
                const isReadByUser = msg.readBy.some(reader =>
                  this.normalizeUsername(reader) === usernameNormalized
                );
                return !isReadByUser;
              }).length;
            } else {
              // Si NO es participante (monitoreo), el contador siempre es 0
              unreadCount = 0;
            }
          } else {
            // Si no hay username, contar todos los mensajes no leidos (comportamiento anterior)
            const allMessages = await this.messageRepository.find({
              where: messageConditions,
            });

            unreadCount = allMessages.filter(msg => !msg.isRead).length;
          }
        }

        // ðŸ”¥ Obtener informaciÃ³n de los participantes (role y numeroAgente)
        // Para conversaciones de monitoreo, obtener info del primer participante que no sea el admin
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
          lastMessage: lastMessage ? lastMessage.text : null,
          lastMessageFrom: lastMessage ? lastMessage.from : null,
          lastMessageTime: lastMessage ? lastMessage.sentAt : null,
          lastMessageMediaType: lastMessage ? lastMessage.mediaType : null,
          lastMessageThreadCount: lastMessage ? lastMessage.threadCount : 0,
          lastMessageLastReplyFrom: lastMessage ? lastMessage.lastReplyFrom : null,
          unreadCount,
          role: participantRole, // ðŸ”¥ Incluir role del participante
          numeroAgente: participantNumeroAgente, // ðŸ”¥ Incluir numeroAgente del participante
        };
      })
    );

    // Ordenar por Ãºltimo mensaje (mÃ¡s reciente primero)
    enrichedConversations.sort((a, b) => {
      if (!a.lastMessageTime && !b.lastMessageTime) return 0;
      if (!a.lastMessageTime) return 1;
      if (!b.lastMessageTime) return -1;
      return new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime();
    });

    return enrichedConversations;
  }

  // 🔥 Función para normalizar nombres (remover acentos y convertir a minúsculas)
  private normalizeUsername(username: string): string {
    return username
      ?.toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') || '';
  }

  async findByUser(username: string): Promise<any[]> {

    // Obtener todas las conversaciones activas y filtrar en memoria
    const allConversations = await this.temporaryConversationRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    // 🔥 MODIFICADO: Filtrar conversaciones donde el usuario está en assignedUsers (normalizado)
    const usernameNormalized = this.normalizeUsername(username);
    console.log(`🔍 findByUser - Buscando conversaciones para: "${username}" (normalizado: "${usernameNormalized}")`);

    const userConversations = allConversations.filter(conv => {
      if (!conv.assignedUsers) return false;
      const found = conv.assignedUsers.some(u => {
        const uNormalized = this.normalizeUsername(u);
        const match = uNormalized === usernameNormalized;
        if (match) {
          console.log(`  ✓ Conversación encontrada: "${conv.name}" - assignedUsers: ${JSON.stringify(conv.assignedUsers)}`);
        }
        return match;
      });
      return found;
    });


    // Enriquecer cada conversaciÃ³n con el Ãºltimo mensaje y contador de no leÃ­dos
    const enrichedConversations = await Promise.all(
      userConversations.map(async (conv) => {
        // Obtener los participantes de la conversaciÃ³n
        const participants = conv.participants || [];

        // Obtener el Ãºltimo mensaje de la conversaciÃ³n
        // Buscar mensajes entre cualquiera de los participantes
        let lastMessage = null;
        let unreadCount = 0;

        if (participants.length >= 2) {
          // Construir condiciones para buscar mensajes entre los participantes
          const messageConditions = [];

          for (let i = 0; i < participants.length; i++) {
            for (let j = i + 1; j < participants.length; j++) {
              messageConditions.push(
                { from: participants[i], to: participants[j], isDeleted: false, threadId: IsNull(), isGroup: false },
                { from: participants[j], to: participants[i], isDeleted: false, threadId: IsNull(), isGroup: false }
              );
            }
          }

          // Obtener el Ãºltimo mensaje
          const messages = await this.messageRepository.find({
            where: messageConditions,
            order: { sentAt: 'DESC' },
            take: 1,
          });

          if (messages.length > 0) {
            // Calcular el threadCount del Ãºltimo mensaje
            const threadCount = await this.messageRepository.count({
              where: { threadId: messages[0].id, isDeleted: false },
            });

            // Obtener el Ãºltimo mensaje del hilo (si existe)
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

          // Contar mensajes no leÃ­dos (mensajes enviados por otros usuarios que el usuario actual no ha leÃ­do)
          // ðŸ”¥ Filtrar solo mensajes dirigidos al usuario actual (case-insensitive)
          const usernameNormalized = username?.toLowerCase().trim();
          const filteredConditions = messageConditions.filter(cond =>
            cond.to?.toLowerCase().trim() === usernameNormalized &&
            cond.from?.toLowerCase().trim() !== usernameNormalized
          );

          // Filtrar solo los mensajes que no han sido leÃ­dos por el usuario actual
          const allMessages = await this.messageRepository.find({
            where: filteredConditions,
          });


          // ðŸ”¥ Filtrar mensajes no leÃ­dos (case-insensitive en readBy)
          unreadCount = allMessages.filter(msg => {
            if (!msg.readBy || msg.readBy.length === 0) {
              return true; // No ha sido leÃ­do por nadie
            }
            // Verificar si el usuario actual estÃ¡ en readBy (case-insensitive)
            const isReadByUser = msg.readBy.some(reader =>
              reader?.toLowerCase().trim() === usernameNormalized
            );
            return !isReadByUser;
          }).length;

        }

        // ðŸ”¥ Obtener informaciÃ³n del otro participante (role y numeroAgente)
        const otherParticipants = participants.filter(p => p !== username);
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
          lastMessage: lastMessage ? lastMessage.text : null,
          lastMessageFrom: lastMessage ? lastMessage.from : null,
          lastMessageTime: lastMessage ? lastMessage.sentAt : null,
          lastMessageMediaType: lastMessage ? lastMessage.mediaType : null,
          lastMessageThreadCount: lastMessage ? lastMessage.threadCount : 0,
          lastMessageLastReplyFrom: lastMessage ? lastMessage.lastReplyFrom : null,
          unreadCount,
          role: otherParticipantRole, // ðŸ”¥ Incluir role del otro participante
          numeroAgente: otherParticipantNumeroAgente, // ðŸ”¥ Incluir numeroAgente del otro participante
        };
      })
    );

    // Ordenar por Ãºltimo mensaje (mÃ¡s reciente primero)
    enrichedConversations.sort((a, b) => {
      if (!a.lastMessageTime && !b.lastMessageTime) return 0;
      if (!a.lastMessageTime) return 1;
      if (!b.lastMessageTime) return -1;
      return new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime();
    });

    return enrichedConversations;
  }

  async findOne(id: number): Promise<TemporaryConversation> {
    const conversation = await this.temporaryConversationRepository.findOne({
      where: { id, isActive: true },
    });

    if (!conversation) {
      throw new NotFoundException('ConversaciÃ³n temporal no encontrada');
    }

    return conversation;
  }

  async findByLinkId(linkId: string): Promise<TemporaryConversation> {
    const conversation = await this.temporaryConversationRepository.findOne({
      where: { linkId, isActive: true },
    });

    if (!conversation) {
      throw new NotFoundException('Enlace de conversaciÃ³n no vÃ¡lido');
    }

    if (new Date() > conversation.expiresAt) {
      throw new BadRequestException('La conversaciÃ³n ha expirado');
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
        'La conversaciÃ³n ha alcanzado el mÃ¡ximo de participantes',
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

    // 🔥 VALIDAR: Verificar si ya existe una conversación activa entre estos usuarios
    const allAssignedConversations = await this.temporaryConversationRepository.find({
      where: { isActive: true, isAssignedByAdmin: true },
    });

    // Buscar si existe una conversación con los mismos participantes
    const existingConversation = allAssignedConversations.find(conv => {
      const participants = conv.participants || [];
      // Verificar si ambos usuarios están en los participantes
      return participants.includes(user1) && participants.includes(user2);
    });

    if (existingConversation) {
      // Retornar la conversación existente en lugar de crear una nueva
      console.log(`⚠️ Conversación duplicada detectada entre ${user1} y ${user2}. Retornando existente.`);
      return existingConversation;
    }

    const linkId = this.generateLinkId();
    const expiresAt = getPeruDate();
    // Conversaciones asignadas por admin no expiran (o expiran en 1 aÃ±o)
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
    // Buscar la conversaciÃ³n sin filtrar por isActive para poder manejar conversaciones ya eliminadas
    const conversation = await this.temporaryConversationRepository.findOne({
      where: { id },
    });

    if (!conversation) {
      throw new NotFoundException('ConversaciÃ³n temporal no encontrada');
    }

    // Si ya estÃ¡ inactiva, no hacer nada (ya fue eliminada)
    if (!conversation.isActive) {
      return;
    }

    // Si se proporciona userId, validar permisos
    if (userId && conversation.createdBy !== userId) {
      throw new BadRequestException(
        'No tienes permisos para eliminar esta conversaciÃ³n',
      );
    }

    conversation.isActive = false;
    await this.temporaryConversationRepository.save(conversation);
  }

  async deactivateConversation(id: number, userId: number, userRole: string): Promise<TemporaryConversation> {

    // Si es ADMIN, JEFEPISO o PROGRAMADOR, puede desactivar cualquier conversaciÃ³n
    const isAdmin = ['ADMIN', 'JEFEPISO', 'PROGRAMADOR'].includes(userRole);

    // Primero buscar la conversaciÃ³n sin restricciones para ver si existe
    const conversationExists = await this.temporaryConversationRepository.findOne({
      where: { id },
    });

    if (!conversationExists) {
      throw new NotFoundException('ConversaciÃ³n no encontrada');
    }


    // Ahora verificar permisos
    const conversation = await this.temporaryConversationRepository.findOne({
      where: isAdmin ? { id } : { id, createdBy: userId },
    });

    if (!conversation) {
      throw new NotFoundException('No tienes permisos para desactivar esta conversaciÃ³n');
    }

    conversation.isActive = false;
    const updatedConversation = await this.temporaryConversationRepository.save(conversation);

    return updatedConversation;
  }

  async activateConversation(id: number, userId: number, userRole: string): Promise<TemporaryConversation> {

    // Si es ADMIN, JEFEPISO o PROGRAMADOR, puede activar cualquier conversaciÃ³n
    const isAdmin = ['ADMIN', 'JEFEPISO', 'PROGRAMADOR'].includes(userRole);

    const conversation = await this.temporaryConversationRepository.findOne({
      where: isAdmin ? { id } : { id, createdBy: userId },
    });

    if (!conversation) {
      throw new NotFoundException('ConversaciÃ³n no encontrada o no tienes permisos');
    }

    conversation.isActive = true;
    const updatedConversation = await this.temporaryConversationRepository.save(conversation);

    return updatedConversation;
  }

  // 🔥 NUEVO: Obtener conversaciones de monitoreo (conversaciones de otros usuarios) con paginación
  async findMonitoringConversations(
    username?: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{ data: any[]; total: number; page: number; limit: number; totalPages: number }> {
    const allConversations = await this.temporaryConversationRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    // Normalizar username para comparación
    const usernameNormalized = this.normalizeUsername(username);
    console.log(`🔍 findMonitoringConversations - Buscando conversaciones de monitoreo para: "${username}" (normalizado: "${usernameNormalized}")`);
    console.log(`  Total de conversaciones activas: ${allConversations.length}`);

    // 🔥 FILTRAR: Devolver conversaciones donde el usuario NO es participante
    let conversationsToEnrich = allConversations;
    if (username && usernameNormalized) {
      conversationsToEnrich = allConversations.filter(conv => {
        const participants = conv.participants || [];
        const isParticipant = participants.some(p =>
          this.normalizeUsername(p) === usernameNormalized
        );
        if (!isParticipant) {
          console.log(`  ✓ Conversación de monitoreo: "${conv.name}" - participants: ${JSON.stringify(participants)}`);
        }
        return !isParticipant; // Invertir la lógica: queremos conversaciones donde NO es participante
      });
      console.log(`  Conversaciones de monitoreo filtradas: ${conversationsToEnrich.length}`);
    }

    // Calcular paginación
    const total = conversationsToEnrich.length;
    const totalPages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;
    const paginatedConversations = conversationsToEnrich.slice(skip, skip + limit);

    // Enriquecer cada conversación con el último mensaje y contador de no leídos
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
                { from: participants[i], to: participants[j], isDeleted: false, threadId: IsNull(), isGroup: false },
                { from: participants[j], to: participants[i], isDeleted: false, threadId: IsNull(), isGroup: false }
              );
            }
          }

          // 🔥 CORREGIDO: Obtener el último mensaje ordenando por ID (no por sentAt que puede estar corrupto)
          const messages = await this.messageRepository.find({
            where: messageConditions,
            order: { id: 'DESC' },
            take: 1,
          });

          console.log(`📊 Monitoreo - Conversación: ${conv.name}, Participantes: ${JSON.stringify(participants)}, Último mensaje ID: ${messages[0]?.id}, Texto: "${messages[0]?.message?.substring(0, 50)}"`);

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
                'image': '📷 Imagen',
                'video': '🎥 Video',
                'audio': '🎵 Audio',
                'document': '📄 Documento'
              };
              messageText = mediaTypeMap[messages[0].mediaType] || '📎 Archivo';
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

          // Para monitoreo, el contador de no leídos siempre es 0
          unreadCount = 0;
        }

        // Obtener información de los participantes (role y numeroAgente)
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
          lastMessage: lastMessage ? lastMessage.text : null,
          lastMessageFrom: lastMessage ? lastMessage.from : null,
          lastMessageTime: lastMessage ? lastMessage.sentAt : null,
          lastMessageMediaType: lastMessage ? lastMessage.mediaType : null,
          lastMessageThreadCount: lastMessage ? lastMessage.threadCount : 0,
          lastMessageLastReplyFrom: lastMessage ? lastMessage.lastReplyFrom : null,
          unreadCount,
          role: participantRole,
          numeroAgente: participantNumeroAgente,
        };
      })
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
