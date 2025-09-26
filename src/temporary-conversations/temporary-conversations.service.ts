import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TemporaryConversation } from './entities/temporary-conversation.entity';
import { CreateTemporaryConversationDto } from './dto/create-temporary-conversation.dto';
import { randomBytes } from 'crypto';

@Injectable()
export class TemporaryConversationsService {
  constructor(
    @InjectRepository(TemporaryConversation)
    private temporaryConversationRepository: Repository<TemporaryConversation>,
  ) {}

  async create(
    createDto: CreateTemporaryConversationDto,
    userId: number,
  ): Promise<TemporaryConversation> {
    const linkId = this.generateLinkId();
    const expiresAt = new Date();
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

  async findAll(): Promise<TemporaryConversation[]> {
    return await this.temporaryConversationRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });
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

  async remove(id: number, userId: number): Promise<void> {
    const conversation = await this.findOne(id);

    if (conversation.createdBy !== userId) {
      throw new BadRequestException(
        'No tienes permisos para eliminar esta conversación',
      );
    }

    conversation.isActive = false;
    await this.temporaryConversationRepository.save(conversation);
  }

  private generateLinkId(): string {
    return randomBytes(8).toString('hex').toUpperCase();
  }
}
