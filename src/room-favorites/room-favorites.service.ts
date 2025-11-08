import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoomFavorite } from './entities/room-favorite.entity';

@Injectable()
export class RoomFavoritesService {
  constructor(
    @InjectRepository(RoomFavorite)
    private roomFavoriteRepository: Repository<RoomFavorite>,
  ) {}

  // Agregar sala a favoritos
  async addFavorite(username: string, roomCode: string, roomId: number): Promise<RoomFavorite> {
    // Verificar si ya existe
    const existing = await this.roomFavoriteRepository.findOne({
      where: { username, roomCode },
    });

    if (existing) {
      // Si ya existe, actualizar isPinned a true
      existing.isPinned = true;
      return await this.roomFavoriteRepository.save(existing);
    }

    // Crear nuevo favorito
    const favorite = this.roomFavoriteRepository.create({
      username,
      roomCode,
      roomId,
      isPinned: true,
    });

    return await this.roomFavoriteRepository.save(favorite);
  }

  // Quitar sala de favoritos
  async removeFavorite(username: string, roomCode: string): Promise<void> {
    await this.roomFavoriteRepository.delete({ username, roomCode });
  }

  // Alternar estado de favorito
  async toggleFavorite(username: string, roomCode: string, roomId: number): Promise<{ isFavorite: boolean }> {
    const existing = await this.roomFavoriteRepository.findOne({
      where: { username, roomCode },
    });

    if (existing) {
      // Si existe, eliminarlo
      await this.roomFavoriteRepository.delete({ username, roomCode });
      return { isFavorite: false };
    } else {
      // Si no existe, crearlo
      await this.addFavorite(username, roomCode, roomId);
      return { isFavorite: true };
    }
  }

  // Obtener todas las salas favoritas de un usuario
  async getUserFavorites(username: string): Promise<RoomFavorite[]> {
    return await this.roomFavoriteRepository.find({
      where: { username },
      order: { createdAt: 'DESC' },
    });
  }

  // Verificar si una sala es favorita para un usuario
  async isFavorite(username: string, roomCode: string): Promise<boolean> {
    const favorite = await this.roomFavoriteRepository.findOne({
      where: { username, roomCode },
    });
    return !!favorite;
  }

  // Obtener códigos de salas favoritas de un usuario (para filtrado rápido)
  async getUserFavoriteRoomCodes(username: string): Promise<string[]> {
    const favorites = await this.getUserFavorites(username);
    return favorites.map(f => f.roomCode);
  }
}

