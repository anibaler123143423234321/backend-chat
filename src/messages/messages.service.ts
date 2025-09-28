import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from './entities/message.entity';
import { CreateMessageDto } from './dto/create-message.dto';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
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
      message.isDeleted = true;
      message.deletedAt = new Date();
      await this.messageRepository.save(message);
      return true;
    }
    return false;
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
}
