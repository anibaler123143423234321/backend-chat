import { Controller, Post, Delete, Get, Body, Param, Query } from '@nestjs/common';
import { RoomFavoritesService } from './room-favorites.service';

@Controller('room-favorites')
export class RoomFavoritesController {
  constructor(private readonly roomFavoritesService: RoomFavoritesService) {}

  // Alternar favorito (agregar o quitar)
  @Post('toggle')
  async toggleFavorite(
    @Body() body: { username: string; roomCode: string; roomId: number },
  ) {
    return await this.roomFavoritesService.toggleFavorite(
      body.username,
      body.roomCode,
      body.roomId,
    );
  }

  // Agregar a favoritos
  @Post()
  async addFavorite(
    @Body() body: { username: string; roomCode: string; roomId: number },
  ) {
    return await this.roomFavoritesService.addFavorite(
      body.username,
      body.roomCode,
      body.roomId,
    );
  }

  // Quitar de favoritos
  @Delete()
  async removeFavorite(
    @Body() body: { username: string; roomCode: string },
  ) {
    await this.roomFavoritesService.removeFavorite(body.username, body.roomCode);
    return { message: 'Favorito eliminado' };
  }

  // Obtener favoritos de un usuario
  @Get('user/:username')
  async getUserFavorites(@Param('username') username: string) {
    return await this.roomFavoritesService.getUserFavorites(username);
  }

  // Verificar si una sala es favorita
  @Get('check')
  async isFavorite(
    @Query('username') username: string,
    @Query('roomCode') roomCode: string,
  ) {
    const isFavorite = await this.roomFavoritesService.isFavorite(username, roomCode);
    return { isFavorite };
  }

  // Obtener códigos de salas favoritas
  @Get('codes/:username')
  async getUserFavoriteRoomCodes(@Param('username') username: string) {
    const roomCodes = await this.roomFavoritesService.getUserFavoriteRoomCodes(username);
    return { roomCodes };
  }
}

