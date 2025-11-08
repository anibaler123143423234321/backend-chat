import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversationFavorite } from './entities/conversation-favorite.entity';

@Injectable()
export class ConversationFavoritesService {
  constructor(
    @InjectRepository(ConversationFavorite)
    private conversationFavoriteRepository: Repository<ConversationFavorite>,
  ) {}

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
}

