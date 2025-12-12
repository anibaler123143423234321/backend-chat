import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { RoomFavorite } from './entities/room-favorite.entity';
import { Message } from '../messages/entities/message.entity';

@Injectable()
export class RoomFavoritesService {
  constructor(
    @InjectRepository(RoomFavorite)
    private roomFavoriteRepository: Repository<RoomFavorite>,
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
  ) { }

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

  // 🔥 NUEVO: Obtener favoritos con datos completos de la sala (JOIN)
  async getUserFavoritesWithRoomData(username: string): Promise<any[]> {
    const favorites = await this.roomFavoriteRepository.find({
      where: { username },
      relations: ['room'],
      order: { createdAt: 'DESC' },
    });

    // Retornar formato consistente con myActiveRooms, filtrando salas inactivas o eliminadas
    // Retornar formato consistente con myActiveRooms, filtrando salas inactivas o eliminadas
    const enrichedFavorites = await Promise.all(
      favorites
        .filter(fav => fav.room && fav.room.isActive)
        .map(async fav => {
          const code = fav.room?.roomCode || fav.roomCode;
          const lastMessage = code ? await this.messageRepository.findOne({
            where: { roomCode: code, isDeleted: false, threadId: IsNull() },
            order: { sentAt: 'DESC' },
          }) : null;

          return {
            id: fav.room.id,
            name: fav.room.name,
            roomCode: fav.roomCode,
            members: fav.room.members,
            isFavorite: true,
            lastMessage: lastMessage ? {
              id: lastMessage.id,
              sentAt: lastMessage.sentAt,
            } : null,
          };
        })
    );

    return enrichedFavorites;
  }
}
