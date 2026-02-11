import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ConversationFavorite } from './entities/conversation-favorite.entity';
import { Message } from '../messages/entities/message.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class ConversationFavoritesService {
  constructor(
    @InjectRepository(ConversationFavorite)
    private conversationFavoriteRepository: Repository<ConversationFavorite>,
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) { }

  // Agregar conversación a favoritos
  async addFavorite(username: string, conversationId: number): Promise<ConversationFavorite> {
    // Verificar si ya existe
    const existing = await this.conversationFavoriteRepository.findOne({
      where: { username, conversationId },
    });

    if (existing) {
      // Si ya existe, actualizar isPinned a true
      existing.isPinned = true;
      return await this.conversationFavoriteRepository.save(existing);
    }

    // Crear nuevo favorito
    const favorite = this.conversationFavoriteRepository.create({
      username,
      conversationId,
      isPinned: true,
    });

    return await this.conversationFavoriteRepository.save(favorite);
  }

  // Quitar conversación de favoritos
  async removeFavorite(username: string, conversationId: number): Promise<void> {
    await this.conversationFavoriteRepository.delete({ username, conversationId });
  }

  // Alternar estado de favorito
  async toggleFavorite(username: string, conversationId: number): Promise<{ isFavorite: boolean }> {
    const existing = await this.conversationFavoriteRepository.findOne({
      where: { username, conversationId },
    });

    if (existing) {
      // Si existe, eliminarlo
      await this.conversationFavoriteRepository.delete({ username, conversationId });
      return { isFavorite: false };
    } else {
      // Si no existe, crearlo
      await this.addFavorite(username, conversationId);
      return { isFavorite: true };
    }
  }

  // Obtener todas las conversaciones favoritas de un usuario
  async getUserFavorites(username: string): Promise<ConversationFavorite[]> {
    return await this.conversationFavoriteRepository.find({
      where: { username },
      order: { createdAt: 'DESC' },
    });
  }

  // Verificar si una conversación es favorita para un usuario
  async isFavorite(username: string, conversationId: number): Promise<boolean> {
    const favorite = await this.conversationFavoriteRepository.findOne({
      where: { username, conversationId },
    });
    return !!favorite;
  }

  // Obtener IDs de conversaciones favoritas de un usuario (para filtrado rápido)
  async getUserFavoriteConversationIds(username: string): Promise<number[]> {
    const favorites = await this.getUserFavorites(username);
    return favorites.map(f => f.conversationId);
  }

  // 🔥 NUEVO: Obtener favoritos con datos completos de la conversación (JOIN/Enriquecimiento)
  async getUserFavoritesWithConversationData(username: string): Promise<any[]> {
    const favorites = await this.conversationFavoriteRepository.find({
      where: { username },
      relations: ['conversation'],
      order: { createdAt: 'DESC' },
    });

    const usernameNormalized = this.normalizeUsername(username);

    // Enriquecer y filtrar
    const enrichedFavorites = await Promise.all(
      favorites
        .filter(fav => {
          // 🔥 FILTRO CRÍTICO: La conversación debe existir, estar activa y el usuario debe ser miembro
          if (!fav.conversation || !fav.conversation.isActive) return false;
          const participants = fav.conversation.participants || [];
          return participants.some(p => this.normalizeUsername(p) === usernameNormalized);
        })
        .map(async fav => {
          const conv = fav.conversation;
          const participants = conv.participants || [];

          let lastMessageInternal = null;
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
              lastMessageInternal = {
                id: messages[0].id,
                text: messages[0].message,
                from: messages[0].from,
                sentAt: messages[0].sentAt,
                mediaType: messages[0].mediaType,
              };
            }

            // Contar mensajes no leídos
            const allMessages = await this.messageRepository.find({
              where: {
                conversationId: conv.id,
                isDeleted: false,
                threadId: IsNull(),
                isGroup: false,
              },
            });

            unreadCount = allMessages.filter((msg) => {
              if (this.normalizeUsername(msg.from) === usernameNormalized) return false;
              if (!msg.readBy || msg.readBy.length === 0) return true;
              return !msg.readBy.some(reader => this.normalizeUsername(reader) === usernameNormalized);
            }).length;
          }

          // Obtener información del otro participante para la imagen/rol
          let otherParticipantRole = null;
          let otherParticipantNumeroAgente = null;
          let otherParticipantPicture = null;

          const otherParticipants = participants.filter(p => this.normalizeUsername(p) !== usernameNormalized);
          if (otherParticipants.length > 0) {
            const otherUser = await this.userRepository.findOne({
              where: { username: otherParticipants[0] },
            });
            if (otherUser) {
              otherParticipantRole = otherUser.role;
              otherParticipantNumeroAgente = otherUser.numeroAgente;
              otherParticipantPicture = otherUser.picture;
            }
          }

          return {
            id: conv.id,
            name: conv.name,
            participants: conv.participants,
            isActive: conv.isActive,
            isFavorite: true,
            unreadCount,
            lastMessageInternal,
            role: otherParticipantRole,
            numeroAgente: otherParticipantNumeroAgente,
            picture: otherParticipantPicture,
          };
        })
    );

    return enrichedFavorites;
  }

  private normalizeUsername(username: string): string {
    return username
      ?.toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') || '';
  }
}

