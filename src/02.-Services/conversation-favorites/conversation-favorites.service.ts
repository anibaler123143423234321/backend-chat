import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ConversationFavorite } from 'src/02.-Services/conversation-favorites/entities/conversation-favorite.entity';
import { Message } from 'src/02.-Services/messages/entities/message.entity';
import { User } from 'src/02.-Services/users/entities/user.entity';
import { MessagesService } from 'src/02.-Services/messages/messages.service';

@Injectable()
export class ConversationFavoritesService {
  constructor(
    @InjectRepository(ConversationFavorite)
    private conversationFavoriteRepository: Repository<ConversationFavorite>,
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @Inject(forwardRef(() => MessagesService))
    private messagesService: MessagesService,
  ) { }

  async addFavorite(username: string, conversationId: number): Promise<ConversationFavorite> {
    const existing = await this.conversationFavoriteRepository.findOne({
      where: { username, conversationId },
    });
    if (existing) {
      existing.isPinned = true;
      return await this.conversationFavoriteRepository.save(existing);
    }
    const favorite = this.conversationFavoriteRepository.create({
      username,
      conversationId,
      isPinned: true,
    });
    return await this.conversationFavoriteRepository.save(favorite);
  }

  async removeFavorite(username: string, conversationId: number): Promise<void> {
    await this.conversationFavoriteRepository.delete({ username, conversationId });
  }

  async toggleFavorite(username: string, conversationId: number): Promise<{ isFavorite: boolean }> {
    const existing = await this.conversationFavoriteRepository.findOne({
      where: { username, conversationId },
    });
    if (existing) {
      await this.conversationFavoriteRepository.delete({ username, conversationId });
      return { isFavorite: false };
    } else {
      await this.addFavorite(username, conversationId);
      return { isFavorite: true };
    }
  }

  async getUserFavorites(username: string): Promise<ConversationFavorite[]> {
    return await this.conversationFavoriteRepository.find({
      where: { username },
      order: { createdAt: 'DESC' },
    });
  }

  async isFavorite(username: string, conversationId: number): Promise<boolean> {
    const favorite = await this.conversationFavoriteRepository.findOne({
      where: { username, conversationId },
    });
    return !!favorite;
  }

  async getUserFavoriteConversationIds(username: string): Promise<number[]> {
    const favorites = await this.getUserFavorites(username);
    return favorites.map(f => f.conversationId);
  }

  async getUserFavoritesWithConversationData(username: string): Promise<any[]> {
    const favorites = await this.conversationFavoriteRepository.find({
      where: { username },
      relations: ['conversation'],
      order: { createdAt: 'DESC' },
    });

    const usernameNormalized = this.normalizeUsername(username);
    const currentUser = await this.userRepository.findOne({
      where: { username: usernameNormalized },
      select: ['nombre', 'apellido'],
    });
    const currentUserFullName = currentUser ? `${currentUser.nombre} ${currentUser.apellido}`.trim() : null;

    const enrichedFavorites = await Promise.all(
      favorites
        .filter(fav => {
          if (!fav.conversation || !fav.conversation.isActive) return false;
          const participants = fav.conversation.participants || [];
          return participants.some(p => this.normalizeUsername(p) === usernameNormalized);
        })
        .map(async fav => {
          const conv = fav.conversation;
          const participants = conv.participants || [];

          let lastMessageInternal = null;
          let unreadCount = 0;
          let lastActivity = conv.updatedAt || conv.createdAt;
          const otherParticipants = participants.filter(p => this.normalizeUsername(p) !== usernameNormalized);

          let otherParticipantPicture = null;
          let otherParticipantName = conv.name;
          let otherParticipantDisplayName = otherParticipants[0] || '';

          const otherUser = otherParticipantDisplayName ? await this.userRepository.findOne({
            where: { username: otherParticipantDisplayName },
            select: ['picture', 'nombre', 'apellido', 'username'],
          }) : null;

          if (otherUser) {
            otherParticipantPicture = otherUser.picture;
            if (participants.length === 2) {
              otherParticipantName = otherUser.nombre && otherUser.apellido
                ? `${otherUser.nombre} ${otherUser.apellido}`.trim()
                : otherUser.nombre || otherParticipantName;
            }
          }

          if (participants.length >= 2) {
            const searchTermsMe = [usernameNormalized];
            if (currentUserFullName) searchTermsMe.push(currentUserFullName);

            const searchTermsOther = [otherParticipantDisplayName];
            if (otherParticipantName) searchTermsOther.push(otherParticipantName);

            const messages = await this.messageRepository.find({
              where: [
                { conversationId: conv.id, isDeleted: false, threadId: IsNull(), isGroup: false },
                ...searchTermsMe.flatMap(me => searchTermsOther.map(other => ({
                  from: me, to: other, isDeleted: false, threadId: IsNull(), isGroup: false
                }))),
                ...searchTermsOther.flatMap(other => searchTermsMe.map(me => ({
                  from: other, to: me, isDeleted: false, threadId: IsNull(), isGroup: false
                }))),
              ],
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
              lastActivity = messages[0].sentAt;
            }

            unreadCount = await this.messagesService.getUnreadCountForUserInConversation(conv.id, username);
          }

          return {
            id: conv.id,
            name: otherParticipantName,
            picture: otherParticipantPicture,
            lastMessageInternal,
            lastActivity: lastActivity,
            unreadCount: unreadCount,
            participants: participants,
            isActive: conv.isActive,
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
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
