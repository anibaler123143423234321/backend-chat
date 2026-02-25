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

  // 🔥 NUEVO: Obtener DNI y Nombre Completo para verificaciones robustas
  private async getUserIdentifiers(username: string): Promise<{ dni: string; fullName: string }> {
    // 1. Intentar buscar por username (DNI)
    let user = await this.userRepository.findOne({ where: { username } });

    // 2. Si no se encuentra, intentar buscar por Nombre Completo (normalizado)
    const normalizedSearch = username.trim().replace(/\s+/g, ' ');

    if (!user && normalizedSearch.includes(' ')) {
      user = await this.userRepository
        .createQueryBuilder('user')
        .where("TRIM(CONCAT(user.nombre, ' ', user.apellido)) = :fullName", { fullName: normalizedSearch })
        .getOne();
    }

    // 3. Si aún no se encuentra, intentar búsqueda flexible por palabras (AND)
    if (!user && normalizedSearch.includes(' ')) {
      const words = normalizedSearch.split(' ').filter(w => w.length > 2);
      if (words.length >= 2) {
        let builder = this.userRepository.createQueryBuilder('user');
        words.forEach((word, idx) => {
          if (idx === 0) {
            builder = builder.where("CONCAT(user.nombre, ' ', user.apellido) LIKE :term" + idx, { ["term" + idx]: `%${word}%` });
          } else {
            builder = builder.andWhere("CONCAT(user.nombre, ' ', word) LIKE :term" + idx, { ["term" + idx]: `%${word}%` });
          }
        });
        user = await builder.getOne();
      }
    }

    if (!user) {
      return { dni: username, fullName: username };
    }

    const fullName = user.nombre && user.apellido
      ? `${user.nombre} ${user.apellido}`.trim()
      : user.username;

    return { dni: user.username, fullName };
  }

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
    // 🔥 MEJORADO: Resolver cada búsqueda a TODOS los identificadores posibles (DNI + nombre completo)
    const search1 = (search || '').trim();
    const search2Val = (search2 || '').trim();

    // Resolver identificadores para cada término de búsqueda
    const resolveSearchIdentifiers = async (term: string): Promise<string[]> => {
      if (!term) return [];
      const termNormalized = this.normalizeUsername(term);
      const identifiers = [termNormalized];

      try {
        // Buscar por username (DNI)
        let user = await this.userRepository.findOne({ where: { username: term } });

        // Si no se encontró, buscar por nombre con LIKE
        if (!user) {
          user = await this.userRepository
            .createQueryBuilder('user')
            .where("CONCAT(user.nombre, ' ', user.apellido) LIKE :pattern", { pattern: `%${term}%` })
            .getOne();
        }

        // Si no se encontró, buscar por nombre o apellido individual
        if (!user) {
          user = await this.userRepository
            .createQueryBuilder('user')
            .where("user.nombre LIKE :pattern OR user.apellido LIKE :pattern", { pattern: `%${term}%` })
            .getOne();
        }

        if (user) {
          identifiers.push(this.normalizeUsername(user.username));
          if (user.nombre && user.apellido) {
            identifiers.push(this.normalizeUsername(`${user.nombre} ${user.apellido}`));
          }
          if (user.nombre) identifiers.push(this.normalizeUsername(user.nombre));
          if (user.apellido) identifiers.push(this.normalizeUsername(user.apellido));
        }
      } catch (e) {
        // Silently continue with just the original term
      }

      // Return unique identifiers
      return [...new Set(identifiers)];
    };

    if (search1 || search2Val) {
      const [ids1, ids2] = await Promise.all([
        resolveSearchIdentifiers(search1),
        resolveSearchIdentifiers(search2Val),
      ]);

      conversationsToEnrich = conversationsToEnrich.filter((conv) => {
        const convNameNormalized = this.normalizeUsername(conv.name || '');
        const participantsNormalized = (conv.participants || []).map((p) =>
          this.normalizeUsername(p),
        );
        const allSearchable = [convNameNormalized, ...participantsNormalized];

        // Cada grupo de búsqueda (Participante 1, Participante 2) debe matchear
        const match1 = ids1.length === 0 || ids1.some(id =>
          allSearchable.some(s => s.includes(id))
        );
        const match2 = ids2.length === 0 || ids2.some(id =>
          allSearchable.some(s => s.includes(id))
        );

        return match1 && match2;
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
        let participantNames = [...participants];

        if (participants.length > 0) {
          try {
            const participantsUsers = await this.userRepository.find({
              where: participants.map(p => ({ username: p }))
            });

            // Map usernames to their actual full names
            participantNames = participants.map(p => {
              const u = participantsUsers.find(user =>
                user.username && typeof user.username === 'string' && typeof p === 'string' &&
                user.username.toUpperCase() === p.toUpperCase()
              );
              if (u) {
                if (u.nombre && u.apellido) return `${u.nombre} ${u.apellido}`;
                return u.nombre || u.apellido || p;
              }
              return p; // fallback to whatever was stored
            });

            // Keep the role/numeroAgente logic for the first participant (compatibility)
            const firstParticipantUser = participantsUsers.find(user =>
              user.username && typeof user.username === 'string' && typeof participants[0] === 'string' &&
              user.username.toUpperCase() === participants[0].toUpperCase()
            );

            if (firstParticipantUser) {
              participantRole = firstParticipantUser.role;
              participantNumeroAgente = firstParticipantUser.numeroAgente;
            }
          } catch (e) {
            console.error('Error fetching participants users:', e);
          }
        }

        return {
          ...conv,
          participantNames, // 🔥 NUEVO: Array con los nombres completos
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
    const { dni, fullName } = await this.getUserIdentifiers(username);
    const dniNormalized = this.normalizeUsername(dni);
    const fullNameNormalized = this.normalizeUsername(fullName);

    // 1. Construir QueryBuilder base
    const queryBuilder = this.temporaryConversationRepository
      .createQueryBuilder('conv')
      .where('conv.isActive = :isActive', { isActive: true });

    // 2. Filtrar por pertenencia (Sintaxis MySQL LIKE para buscar en JSON array)
    if (username) {
      // 🚀 MODIFICADO: Buscar tanto por DNI como por Nombre Completo
      queryBuilder.andWhere(
        '(conv.participants LIKE :searchByDni OR conv.participants LIKE :searchByName)',
        {
          searchByDni: `%${dni}%`,
          searchByName: `%${fullName}%`,
        }
      );

      // 3. Excluir favoritos directamente en SQL
      // 🔥 FIX: Verificar favoritos por DNI
      queryBuilder.andWhere(
        `NOT EXISTS (
          SELECT 1 FROM conversation_favorites cf 
          WHERE cf.conversationId = conv.id 
          AND cf.username = :favUser
        )`,
        { favUser: dni }
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
            if (participants.length >= 2 && username) {
              const otherParticipants = participants.filter(
                (p) => {
                  const pNorm = this.normalizeUsername(p);
                  return pNorm !== dniNormalized && pNorm !== fullNameNormalized;
                },
              );

              if (otherParticipants.length > 0) {
                // 🔥 SQL OPTIMIZATION: Usar count() directo en DB
                const qb = this.messageRepository.createQueryBuilder('msg');
                unreadCount = await qb
                  .where('msg.conversationId = :convId', { convId: conv.id }) // 🔥 Filtrar por conversación primero
                  .andWhere('(msg.to = :dni OR msg.to = :fullName)', { dni, fullName })
                  .andWhere('msg.from IN (:...others)', { others: otherParticipants })
                  .andWhere('msg.isDeleted = :isDeleted', { isDeleted: false })
                  .andWhere('msg.threadId IS NULL')
                  .andWhere('msg.isGroup = :isGroup', { isGroup: false })
                  .andWhere('NOT (JSON_CONTAINS(COALESCE(msg.readBy, "[]"), :dniJson) OR JSON_CONTAINS(COALESCE(msg.readBy, "[]"), :nameJson))', {
                    dniJson: JSON.stringify(dniNormalized),
                    nameJson: JSON.stringify(fullNameNormalized),
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

          // 🔥 Obtener información del otro participante (imagen y nombre completo)
          let otherParticipantPicture = null;
          let otherParticipantFullName = null;
          let fallbackName = conv.name;

          if (participants.length > 0 && username) {
            const others = participants.filter((p) => {
              const pNorm = this.normalizeUsername(p);
              return pNorm !== dniNormalized && pNorm !== fullNameNormalized;
            });
            if (others.length > 0) {
              const otherId = others[0];

              // Si el ID del otro no es un número (DNI), significa que es un nombre antiguo hardcodeado.
              // Usamos ese nombre antiguo como fallback en lugar de `conv.name` (que a veces tiene el nombre del usuario actual).
              const isDniOrEmail = /^\d+$/.test(otherId) || otherId.includes('@');
              if (!isDniOrEmail && otherId) {
                fallbackName = otherId; // Ej: "JOSÉ TORRES CHIRINOS"
              }

              const otherUser = await this.userRepository.findOne({
                where: { username: otherId },
                select: ['picture', 'nombre', 'apellido'],
              });

              if (otherUser) {
                otherParticipantPicture = otherUser.picture;
                if (otherUser.nombre && otherUser.apellido) {
                  otherParticipantFullName = `${otherUser.nombre} ${otherUser.apellido}`;
                }
              }
            }
          }

          return {
            id: conv.id,
            name: otherParticipantFullName || fallbackName, // 🔥 Mostrar el nombre real del contacto, fallback inteligente
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
    const { dni, fullName } = await this.getUserIdentifiers(username);
    const dniNormalized = this.normalizeUsername(dni);
    const fullNameNormalized = this.normalizeUsername(fullName);

    // Obtener todas las conversaciones activas y filtrar en memoria
    const allConversations = await this.temporaryConversationRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    // ?? Filtrar conversaciones donde el usuario esté en assignedUsers (normalizado)
    const userConversations = allConversations.filter((conv) => {
      if (!conv.assignedUsers) return false;
      return conv.assignedUsers.some((u) => {
        const uNormalized = this.normalizeUsername(u);
        return uNormalized === dniNormalized || uNormalized === fullNameNormalized;
      });
    });

    // Enriquecer cada conversación con el último mensaje y contador de no leídos
    const enrichedConversations = await Promise.all(
      userConversations.map(async (conv) => {
        // Obtener los participantes de la conversación
        const participants = conv.participants || [];
        let lastMessage = null;
        let unreadCount = 0;

        if (participants.length >= 2) {
          // Obtener el último mensaje de la conversación
          const messages = await this.messageRepository.find({
            where: [
              { conversationId: conv.id, isDeleted: false, threadId: IsNull(), isGroup: false }
            ],
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

          // 🔥 CALCULAR UNREAD COUNT
          try {
            const otherParticipants = participants.filter((p) => {
              const pNorm = this.normalizeUsername(p);
              return pNorm !== dniNormalized && pNorm !== fullNameNormalized;
            });

            if (otherParticipants.length > 0) {
              const qb = this.messageRepository.createQueryBuilder('msg');
              unreadCount = await qb
                .where('msg.conversationId = :convId', { convId: conv.id })
                .andWhere('(msg.to = :dni OR msg.to = :fullName)', { dni, fullName })
                .andWhere('msg.from IN (:...others)', { others: otherParticipants })
                .andWhere('msg.isDeleted = :isDeleted', { isDeleted: false })
                .andWhere('msg.threadId IS NULL')
                .andWhere('msg.isGroup = :isGroup', { isGroup: false })
                .andWhere('NOT (JSON_CONTAINS(COALESCE(msg.readBy, "[]"), :dniJson) OR JSON_CONTAINS(COALESCE(msg.readBy, "[]"), :nameJson))', {
                  dniJson: JSON.stringify(dniNormalized),
                  nameJson: JSON.stringify(fullNameNormalized),
                })
                .getCount();
            }
          } catch (e) {
            console.error(`Error counting unread for conv ${conv.id}:`, e);
          }
        }

        // 🔥 Obtener información del otro participante (imagen, nombre completo, etc.)
        const others = participants.filter((p) => {
          const pNorm = this.normalizeUsername(p);
          return pNorm !== dniNormalized && pNorm !== fullNameNormalized;
        });

        let otherParticipantRole = null;
        let otherParticipantNumeroAgente = null;
        let otherParticipantPicture = null;
        let otherParticipantFullName = null;

        if (others.length > 0) {
          const otherId = others[0];
          const otherUser = await this.userRepository.findOne({
            where: { username: otherId },
            select: ['id', 'username', 'picture', 'nombre', 'apellido', 'role', 'numeroAgente'],
          });

          if (otherUser) {
            otherParticipantRole = otherUser.role;
            otherParticipantNumeroAgente = otherUser.numeroAgente;
            otherParticipantPicture = otherUser.picture;
            if (otherUser.nombre && otherUser.apellido) {
              otherParticipantFullName = `${otherUser.nombre} ${otherUser.apellido}`;
            }
          }
        }

        return {
          ...conv,
          name: otherParticipantFullName || conv.name,
          unreadCount,
          lastMessage,
          role: otherParticipantRole,
          numeroAgente: otherParticipantNumeroAgente,
          picture: otherParticipantPicture,
        };
      }),
    );

    // Ordenar por último mensaje o creación (más reciente primero)
    enrichedConversations.sort((a, b) => {
      const aTime = a.lastMessage?.sentAt || a.createdAt;
      const bTime = b.lastMessage?.sentAt || b.createdAt;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
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

    // 🔥 HARD DELETE: Eliminar permanentemente de la base de datos
    // La funcionalidad de "desactivar" (soft delete) ya existe en deactivateConversation()
    await this.temporaryConversationRepository.remove(conversation);
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
