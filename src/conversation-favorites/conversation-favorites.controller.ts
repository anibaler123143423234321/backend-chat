import { Controller, Post, Delete, Get, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ConversationFavoritesService } from './conversation-favorites.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';

@ApiTags('Favoritos (Chats)')
@Controller('conversation-favorites')
export class ConversationFavoritesController {
  constructor(private readonly conversationFavoritesService: ConversationFavoritesService) { }

  // Alternar favorito (agregar o quitar)
  @ApiBearerAuth()
  @Post('toggle')
  @ApiOperation({ summary: 'Alternar estado de favorito (agregar/quitar)' })
  @ApiBody({ schema: { type: 'object', properties: { username: { type: 'string' }, conversationId: { type: 'number' } } } })
  @ApiResponse({ status: 200, description: 'Estado alternado' })
  async toggleFavorite(
    @Body() body: { username: string; conversationId: number },
  ) {
    return await this.conversationFavoritesService.toggleFavorite(
      body.username,
      body.conversationId,
    );
  }

  // Agregar a favoritos
  @ApiBearerAuth()
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
  @ApiBearerAuth()
  @Delete()
  async removeFavorite(
    @Body() body: { username: string; conversationId: number },
  ) {
    await this.conversationFavoritesService.removeFavorite(body.username, body.conversationId);
    return { message: 'Favorito eliminado' };
  }

  // Obtener favoritos de un usuario
  @Get('user/:username')
  @ApiOperation({ summary: 'Obtener conversaciones favoritas de un usuario' })
  @ApiParam({ name: 'username' })
  @ApiResponse({ status: 200, description: 'Lista de favoritos' })
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

