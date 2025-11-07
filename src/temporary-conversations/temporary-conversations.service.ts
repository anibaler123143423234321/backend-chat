import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TemporaryConversation } from './entities/temporary-conversation.entity';
import { CreateTemporaryConversationDto } from './dto/create-temporary-conversation.dto';
import { Message } from '../messages/entities/message.entity';
import { randomBytes } from 'crypto';

@Injectable()
export class TemporaryConversationsService {
  constructor(
    @InjectRepository(TemporaryConversation)
    private temporaryConversationRepository: Repository<TemporaryConversation>,
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
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

  async findAll(): Promise<any[]> {
    const allConversations = await this.temporaryConversationRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    // Enriquecer cada conversación con el último mensaje y contador de no leídos
    const enrichedConversations = await Promise.all(
      allConversations.map(async (conv) => {
        const participants = conv.participants || [];

        let lastMessage = null;
        let unreadCount = 0;

        if (participants.length >= 2) {
          // Construir condiciones para buscar mensajes entre los participantes
          const messageConditions = [];

          for (let i = 0; i < participants.length; i++) {
            for (let j = i + 1; j < participants.length; j++) {
              messageConditions.push(
                { from: participants[i], to: participants[j], isDeleted: false },
                { from: participants[j], to: participants[i], isDeleted: false }
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
            lastMessage = {
              id: messages[0].id,
              text: messages[0].message,
              from: messages[0].from,
              to: messages[0].to,
              sentAt: messages[0].sentAt,
              mediaType: messages[0].mediaType,
            };
          }

          // Contar mensajes no leídos totales en la conversación
          const allMessages = await this.messageRepository.find({
            where: messageConditions,
          });

          unreadCount = allMessages.filter(msg => !msg.isRead).length;
        }

        return {
          ...conv,
          lastMessage: lastMessage ? lastMessage.text : null,
          lastMessageFrom: lastMessage ? lastMessage.from : null,
          lastMessageTime: lastMessage ? lastMessage.sentAt : null,
          lastMessageMediaType: lastMessage ? lastMessage.mediaType : null,
          unreadCount,
        };
      })
    );

    // Ordenar por último mensaje (más reciente primero)
    enrichedConversations.sort((a, b) => {
      if (!a.lastMessageTime && !b.lastMessageTime) return 0;
      if (!a.lastMessageTime) return 1;
      if (!b.lastMessageTime) return -1;
      return new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime();
    });

    return enrichedConversations;
  }

  async findByUser(username: string): Promise<any[]> {
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

    // Enriquecer cada conversación con el último mensaje y contador de no leídos
    const enrichedConversations = await Promise.all(
      userConversations.map(async (conv) => {
        // Obtener los participantes de la conversación (excluyendo al usuario actual)
        const participants = conv.participants || [];
        const otherParticipants = participants.filter(p => p !== username);

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
                { from: participants[i], to: participants[j], isDeleted: false },
                { from: participants[j], to: participants[i], isDeleted: false }
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
            lastMessage = {
              id: messages[0].id,
              text: messages[0].message,
              from: messages[0].from,
              to: messages[0].to,
              sentAt: messages[0].sentAt,
              mediaType: messages[0].mediaType,
            };
          }

          // Contar mensajes no leídos (mensajes enviados por otros usuarios que el usuario actual no ha leído)
          const unreadMessages = await this.messageRepository.count({
            where: messageConditions.filter(cond =>
              cond.to === username && // Mensajes dirigidos al usuario actual
              cond.isDeleted === false
            ),
          });

          // Filtrar solo los mensajes que no han sido leídos por el usuario actual
          const allMessages = await this.messageRepository.find({
            where: messageConditions.filter(cond => cond.to === username),
          });

          unreadCount = allMessages.filter(msg =>
            !msg.readBy || !msg.readBy.includes(username)
          ).length;
        }

        return {
          ...conv,
          lastMessage: lastMessage ? lastMessage.text : null,
          lastMessageFrom: lastMessage ? lastMessage.from : null,
          lastMessageTime: lastMessage ? lastMessage.sentAt : null,
          lastMessageMediaType: lastMessage ? lastMessage.mediaType : null,
          unreadCount,
        };
      })
    );

    // Ordenar por último mensaje (más reciente primero)
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
    // Buscar la conversación sin filtrar por isActive para poder manejar conversaciones ya eliminadas
    const conversation = await this.temporaryConversationRepository.findOne({
      where: { id },
    });

    if (!conversation) {
      throw new NotFoundException('Conversación temporal no encontrada');
    }

    // Si ya está inactiva, no hacer nada (ya fue eliminada)
    if (!conversation.isActive) {
      console.log(`⚠️ Conversación ${id} ya estaba inactiva`);
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

  async deactivateConversation(id: number, userId: number, userRole: string): Promise<TemporaryConversation> {
    console.log('⏸️ Desactivando conversación:', id, 'por usuario:', userId, 'rol:', userRole);

    // Si es ADMIN, JEFEPISO o PROGRAMADOR, puede desactivar cualquier conversación
    const isAdmin = ['ADMIN', 'JEFEPISO', 'PROGRAMADOR'].includes(userRole);
    console.log('🔐 ¿Es admin?:', isAdmin);

    // Primero buscar la conversación sin restricciones para ver si existe
    const conversationExists = await this.temporaryConversationRepository.findOne({
      where: { id },
    });

    if (!conversationExists) {
      console.log('❌ Conversación no existe con ID:', id);
      throw new NotFoundException('Conversación no encontrada');
    }

    console.log('📋 Conversación encontrada:', conversationExists.name, 'creada por:', conversationExists.createdBy);

    // Ahora verificar permisos
    const conversation = await this.temporaryConversationRepository.findOne({
      where: isAdmin ? { id } : { id, createdBy: userId },
    });

    if (!conversation) {
      console.log('❌ Usuario no tiene permisos. isAdmin:', isAdmin, 'userId:', userId, 'createdBy:', conversationExists.createdBy);
      throw new NotFoundException('No tienes permisos para desactivar esta conversación');
    }

    conversation.isActive = false;
    const updatedConversation = await this.temporaryConversationRepository.save(conversation);
    console.log('✅ Conversación desactivada:', updatedConversation.name);

    return updatedConversation;
  }

  async activateConversation(id: number, userId: number, userRole: string): Promise<TemporaryConversation> {
    console.log('▶️ Activando conversación:', id, 'por usuario:', userId, 'rol:', userRole);

    // Si es ADMIN, JEFEPISO o PROGRAMADOR, puede activar cualquier conversación
    const isAdmin = ['ADMIN', 'JEFEPISO', 'PROGRAMADOR'].includes(userRole);

    const conversation = await this.temporaryConversationRepository.findOne({
      where: isAdmin ? { id } : { id, createdBy: userId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada o no tienes permisos');
    }

    conversation.isActive = true;
    const updatedConversation = await this.temporaryConversationRepository.save(conversation);
    console.log('✅ Conversación activada:', updatedConversation.name);

    return updatedConversation;
  }

  private generateLinkId(): string {
    return randomBytes(8).toString('hex').toUpperCase();
  }
}
