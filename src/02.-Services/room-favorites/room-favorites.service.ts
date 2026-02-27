import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { RoomFavorite } from 'src/02.-Services/room-favorites/entities/room-favorite.entity';
import { Message } from 'src/02.-Services/messages/entities/message.entity';
import { TemporaryRoom } from 'src/02.-Services/temporary-rooms/entities/temporary-room.entity';
import { ConversationFavoritesService } from 'src/02.-Services/conversation-favorites/conversation-favorites.service';
import { MessagesService } from 'src/02.-Services/messages/messages.service';

@Injectable()
export class RoomFavoritesService {
  constructor(
    @InjectRepository(RoomFavorite)
    private roomFavoriteRepository: Repository<RoomFavorite>,
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    @InjectRepository(TemporaryRoom)
    private temporaryRoomRepository: Repository<TemporaryRoom>,
    private conversationFavoritesService: ConversationFavoritesService,
    @Inject(forwardRef(() => MessagesService))
    private messagesService: MessagesService,
  ) { }

  // Agregar sala a favoritos
  async addFavorite(username: string, roomCode: string, roomId: number): Promise<RoomFavorite> {
    if (!roomId) {
      const room = await this.temporaryRoomRepository.findOne({ where: { roomCode } });
      if (room) {
        roomId = room.id;
      } else {
        throw new Error('Sala temporal no encontrada para obtener el roomId');
      }
    }

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
    const roomFavorites = await this.getUserFavorites(username);
    const roomCodes = roomFavorites.map(f => f.roomCode);

    // 🔥 NUEVO: También incluir IDs de conversaciones favoritas
    let conversationIds = [];
    try {
      conversationIds = await this.conversationFavoritesService.getUserFavoriteConversationIds(username);
    } catch (e) {
      console.error('Error fetching favorite conversation IDs:', e);
    }

    // Combinar ambos (roomCodes y convIds como strings)
    return [...roomCodes, ...conversationIds.map(id => id.toString())];
  }

  // 🔥 NUEVO: Obtener favoritos con datos completos de la sala (JOIN)
  // 🚀 MODIFICADO: Ahora trae tanto grupos (Rooms) como conversaciones (Chats)
  async getUserFavoritesWithRoomData(username: string): Promise<any[]> {
    // 1. Obtener salas favoritas
    const roomFavorites = await this.roomFavoriteRepository.find({
      where: { username },
      relations: ['room'],
      order: { createdAt: 'DESC' },
    });

    // Enriquecer salas
    const enrichedRoomFavorites = await Promise.all(
      roomFavorites
        .filter(fav => fav.room && fav.room.isActive)
        .map(async fav => {
          const code = fav.room?.roomCode || fav.roomCode;
          const lastMessage = code ? await this.messageRepository.findOne({
            where: { roomCode: code, isDeleted: false, threadId: IsNull() },
            order: { sentAt: 'DESC' },
          }) : null;

          // 🔥 CORREGIDO: Calcular unreadCount real para la sala
          const unreadCount = code ? await this.messagesService.getUnreadCountForUserInRoom(code, username) : 0;

          return {
            id: fav.room.id,
            name: fav.room.name,
            roomCode: fav.roomCode,
            description: fav.room.description, // picture URL
            type: 'room', // 🔥 Discriminador
            isFavorite: true,
            unreadCount: unreadCount,
            lastActivity: lastMessage ? lastMessage.sentAt : (fav.room.updatedAt || fav.room.createdAt), // 🔥 NUEVO: Ordenamiento
            lastMessageInternal: lastMessage ? {
              id: lastMessage.id,
              sentAt: lastMessage.sentAt,
              text: lastMessage.message,
              from: lastMessage.from,
            } : null,
          };
        })
    );

    // 2. Obtener conversaciones favoritas
    let conversationFavorites = [];
    try {
      conversationFavorites = await this.conversationFavoritesService.getUserFavoritesWithConversationData(username);
    } catch (error) {
      console.error('Error al obtener conversaciones favoritas:', error);
    }

    // Normalizar conversaciones para la misma estructura
    const normalizedConvFavorites = conversationFavorites.map(({ updatedAt, createdAt, lastMessageInternal, ...conv }) => ({
      ...conv,
      roomCode: conv.id.toString(), // Para conv usamos el ID como roomCode en el frontend
      type: 'conv', // 🔥 Discriminador
      isFavorite: true,
      lastActivity: conv.lastActivity || updatedAt || createdAt, // 🔥 Asegurar que pase y tenga fallback
      lastMessageInternal, // 🔥 Para ordenar pero no para el return
    }));

    // 3. Combinar ambos
    const allFavorites = [...enrichedRoomFavorites, ...normalizedConvFavorites];

    // Ordenar por fecha de última actividad (más reciente primero)
    allFavorites.sort((a, b) => {
      const dateA = new Date(a.lastActivity || 0).getTime();
      const dateB = new Date(b.lastActivity || 0).getTime();
      return dateB - dateA;
    });

    // 🔥 NUEVO: Devolver metadata del mensaje (lastMessage) y actividad para que el frontend pueda ordenar inicialmente
    return allFavorites.map(({ lastMessageInternal, ...rest }) => ({
      ...rest,
      lastMessage: lastMessageInternal ? {
        text: lastMessageInternal.text || lastMessageInternal.message,
        from: lastMessageInternal.from,
        sentAt: lastMessageInternal.sentAt
      } : null,
      lastActivity: rest.lastActivity // Asegurar que pase al frontend
    }));
  }
}
