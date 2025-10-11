import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Message } from './entities/message.entity';
import { CreateMessageDto } from './dto/create-message.dto';
import { TemporaryRoom } from '../temporary-rooms/entities/temporary-room.entity';

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
      sentAt: createMessageDto.sentAt || new Date(),
    });

    return await this.messageRepository.save(message);
  }

  async findByRoom(
    roomCode: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<Message[]> {
    // Cargar mensajes en orden DESC (más recientes primero) para paginación estilo WhatsApp
    const messages = await this.messageRepository.find({
      where: { roomCode, isDeleted: false },
      order: { sentAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    // Revertir el orden para mostrar cronológicamente (más antiguos arriba, más recientes abajo)
    return messages.reverse();
  }

  async findByUser(
    from: string,
    to: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<Message[]> {
    return await this.messageRepository.find({
      where: [
        { from, to, isDeleted: false },
        { from: to, to: from, isDeleted: false },
      ],
      order: { sentAt: 'ASC' },
      take: limit,
      skip: offset,
    });
  }

  async findRecentMessages(limit: number = 20): Promise<Message[]> {
    return await this.messageRepository.find({
      where: { isDeleted: false },
      order: { sentAt: 'DESC' },
      take: limit,
    });
  }

  async markAsRead(messageId: number, username: string): Promise<void> {
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
    });
    if (message) {
      if (!message.readBy) {
        message.readBy = [];
      }
      if (!message.readBy.includes(username)) {
        message.readBy.push(username);
      }
      message.isRead = true;
      await this.messageRepository.save(message);
    }
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
    const message = await this.messageRepository.findOne({
      where: { id: messageId, from: username },
    });

    if (message) {
      message.message = newText;
      message.isEdited = true;
      message.editedAt = new Date();
      await this.messageRepository.save(message);
      return message;
    }
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

    // Buscar mensajes donde el usuario es el remitente o el destinatario
    const messages = await this.messageRepository.find({
      where: [
        {
          from: username,
          message: Like(`%${searchTerm}%`),
          isDeleted: false,
        },
        {
          to: username,
          message: Like(`%${searchTerm}%`),
          isDeleted: false,
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
}
