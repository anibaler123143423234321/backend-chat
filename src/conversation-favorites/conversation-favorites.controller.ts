import { Controller, Post, Delete, Get, Body, Param, Query } from '@nestjs/common';
import { ConversationFavoritesService } from './conversation-favorites.service';

@Controller('conversation-favorites')
export class ConversationFavoritesController {
  constructor(private readonly conversationFavoritesService: ConversationFavoritesService) {}

  // Alternar favorito (agregar o quitar)
  @Post('toggle')
  async toggleFavorite(
    @Body() body: { username: string; conversationId: number },
  ) {
    return await this.conversationFavoritesService.toggleFavorite(
      body.username,
      body.conversationId,
    );
  }

  // Agregar a favoritos
  @Post()
  async addFavorite(
    @Body() body: { username: string; conversationId: number },
  ) {
    return await this.conversationFavoritesService.addFavorite(
      body.username,
      body.conversationId,
    );
  }

  // Quitar de favoritos
  @Delete()
  async removeFavorite(
    @Body() body: { username: string; conversationId: number },
  ) {
    await this.conversationFavoritesService.removeFavorite(body.username, body.conversationId);
    return { message: 'Favorito eliminado' };
  }

  // Obtener favoritos de un usuario
  @Get('user/:username')
  async getUserFavorites(@Param('username') username: string) {
    return await this.conversationFavoritesService.getUserFavorites(username);
  }

  // Verificar si una conversación es favorita
  @Get('check')
  async isFavorite(
    @Query('username') username: string,
    @Query('conversationId') conversationId: number,
  ) {
    const isFavorite = await this.conversationFavoritesService.isFavorite(username, conversationId);
    return { isFavorite };
  }

  // Obtener IDs de conversaciones favoritas
  @Get('ids/:username')
  async getUserFavoriteConversationIds(@Param('username') username: string) {
    const conversationIds = await this.conversationFavoritesService.getUserFavoriteConversationIds(username);
    return { conversationIds };
  }
}

