import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, IsNull } from 'typeorm';
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
    const message = this.messageRepository.create({
      ...createMessageDto,
      sentAt: createMessageDto.sentAt || getPeruDate(),
    });

    return await this.messageRepository.save(message);
  }

  async findByRoom(
    roomCode: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<Message[]> {
    // Cargar mensajes en orden DESC (más recientes primero) para paginación estilo WhatsApp
    // 🔥 Excluir mensajes de hilos (threadId debe ser null)
    const messages = await this.messageRepository.find({
      where: { roomCode, isDeleted: false, threadId: IsNull() },
      order: { sentAt: 'DESC' },
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

    // Revertir el orden para mostrar cronológicamente (más antiguos arriba, más recientes abajo)
    return messages.reverse();
  }

  async findByUser(
    from: string,
    to: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<Message[]> {
    // 🔥 CORREGIDO: Agregar isGroup: false para excluir mensajes de grupo
    // Esto asegura que solo se retornen mensajes privados entre los dos usuarios específicos
    const messages = await this.messageRepository.find({
      where: [
        { from, to, isDeleted: false, threadId: IsNull(), isGroup: false },
        { from: to, to: from, isDeleted: false, threadId: IsNull(), isGroup: false },
      ],
      order: { sentAt: 'ASC' },
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

    return messages;
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
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
    });

    if (!message) {
      return null;
    }

    // Inicializar reactions si no existe
    if (!message.reactions) {
      message.reactions = [];
    }

    // Buscar si el usuario ya reaccionó con este emoji
    const existingReactionIndex = message.reactions.findIndex(
      (r) => r.username === username && r.emoji === emoji,
    );

    if (existingReactionIndex !== -1) {
      // Si ya existe, quitarla
      message.reactions.splice(existingReactionIndex, 1);
    } else {
      // Quitar cualquier otra reacción del usuario (solo una reacción por usuario)
      message.reactions = message.reactions.filter(
        (r) => r.username !== username,
      );

      // Agregar la nueva reacción
      message.reactions.push({
        emoji,
        username,
        timestamp: new Date(),
      });
    }

    await this.messageRepository.save(message);
    return message;
  }

  async deleteMessage(messageId: number, username: string): Promise<boolean> {
    const message = await this.messageRepository.findOne({
      where: { id: messageId, from: username },
    });

    if (message) {
      // 🔥 NUEVO: Validar si el mensaje pertenece a una sala asignada por admin
      if (message.roomCode) {
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
      await this.messageRepository.save(message);
      return true;
    }
    return false;
  }

  async editMessage(
    messageId: number,
    username: string,
    newText: string,
  ): Promise<Message | null> {
    // 🔥 Primero intentar búsqueda exacta
    let message = await this.messageRepository.findOne({
      where: { id: messageId, from: username },
    });

    // 🔥 Si no se encuentra, intentar búsqueda case-insensitive
    if (!message) {
      const allMessages = await this.messageRepository.find({
        where: { id: messageId },
      });

      // Buscar el mensaje con coincidencia case-insensitive
      message = allMessages.find(
        msg => msg.from?.toLowerCase().trim() === username?.toLowerCase().trim()
      );

      if (message) {
        console.log(`✅ Mensaje encontrado con búsqueda case-insensitive: "${message.from}" vs "${username}"`);
      }
    }

    if (message) {
      message.message = newText;
      message.isEdited = true;
      message.editedAt = new Date();
      await this.messageRepository.save(message);
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
    limit: number = 50,
  ): Promise<any[]> {
    if (!searchTerm || searchTerm.trim().length === 0) {
      return [];
    }

    // 🔥 Buscar mensajes donde el usuario es el remitente o el destinatario
    // Excluir mensajes de hilos (threadId debe ser null)
    // 🔥 CORREGIDO: Agregar isGroup: false para excluir mensajes de grupo
    const messages = await this.messageRepository.find({
      where: [
        {
          from: username,
          message: Like(`%${searchTerm}%`),
          isDeleted: false,
          threadId: IsNull(),
          isGroup: false,
        },
        {
          to: username,
          message: Like(`%${searchTerm}%`),
          isDeleted: false,
          threadId: IsNull(),
          isGroup: false,
        },
      ],
      order: { sentAt: 'DESC' },
      take: limit,
    });

    // Agrupar mensajes por conversación
    const conversationsMap = new Map();

    for (const msg of messages) {
      // Determinar el otro usuario en la conversación
      const otherUser = msg.from === username ? msg.to : msg.from;

      if (!conversationsMap.has(otherUser)) {
        conversationsMap.set(otherUser, {
          user: otherUser,
          messages: [],
          lastMessage: {
            id: msg.id,
            text: msg.message,
            from: msg.from,
            to: msg.to,
            sentAt: msg.sentAt,
          },
          lastMessageTime: msg.sentAt,
        });
      }

      conversationsMap.get(otherUser).messages.push({
        id: msg.id,
        text: msg.message,
        from: msg.from,
        to: msg.to,
        sentAt: msg.sentAt,
      });
    }

    // Convertir el mapa a array y ordenar por último mensaje
    const conversations = Array.from(conversationsMap.values()).sort(
      (a, b) => b.lastMessageTime.getTime() - a.lastMessageTime.getTime(),
    );

    return conversations;
  }

  // Obtener mensajes de un hilo específico
  async findThreadMessages(
    threadId: number,
    limit: number = 50,
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
