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

  async findByUser(username: string): Promise<TemporaryConversation[]> {
    console.log('🔍 Buscando conversaciones para usuario:', username);

    // Obtener todas las conversaciones activas y filtrar en memoria
    const allConversations = await this.temporaryConversationRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    console.log('📋 Total de conversaciones activas:', allConversations.length);
    allConversations.forEach(conv => {
      console.log(`  - Conversación ID ${conv.id}: assignedUsers =`, conv.assignedUsers);
    });

    // Filtrar conversaciones donde el usuario está en assignedUsers
    const userConversations = allConversations.filter(conv =>
      conv.assignedUsers && conv.assignedUsers.includes(username)
    );

    console.log('✅ Conversaciones encontradas para', username, ':', userConversations.length);

    return userConversations;
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
    console.log('💬 Creando conversación asignada:');
    console.log('  - user1:', user1);
    console.log('  - user2:', user2);
    console.log('  - name:', name);
    console.log('  - adminId:', adminId);

    const linkId = this.generateLinkId();
    const expiresAt = new Date();
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
    console.log('✅ Conversación guardada con ID:', saved.id);
    console.log('  - assignedUsers:', saved.assignedUsers);

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
    const conversation = await this.findOne(id);

    // Si se proporciona userId, validar permisos
    if (userId && conversation.createdBy !== userId) {
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
