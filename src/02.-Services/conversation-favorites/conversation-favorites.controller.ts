import { Controller, Post, Delete, Get, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ConversationFavoritesService } from 'src/02.-Services/conversation-favorites/conversation-favorites.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { SocketGateway } from 'src/03.-Socket/socket/socket.gateway';

@ApiTags('Favoritos (Chats)')
@Controller('conversation-favorites')
export class ConversationFavoritesController {
  constructor(
    private readonly conversationFavoritesService: ConversationFavoritesService,
    private readonly socketGateway: SocketGateway,
  ) { }

  // Alternar favorito (agregar o quitar)
  @ApiBearerAuth()
  @Post('toggle')
  @ApiOperation({ summary: 'Alternar estado de favorito (agregar/quitar)' })
  @ApiBody({ schema: { type: 'object', properties: { username: { type: 'string' }, conversationId: { type: 'number' } } } })
  @ApiResponse({ status: 200, description: 'Estado alternado' })
  async toggleFavorite(
    @Body() body: { username: string; conversationId: number },
  ) {
    const result = await this.conversationFavoritesService.toggleFavorite(
      body.username,
      body.conversationId,
    );

    //  Notificar sincronización
    this.socketGateway.notifyFavoriteChanged(body.username, {
      type: 'conv',
      conversationId: body.conversationId,
      isFavorite: result.isFavorite
    });

    return result;
  }

  // Agregar a favoritos
  @ApiBearerAuth()
  @Post()
  async addFavorite(
    @Body() body: { username: string; conversationId: number },
  ) {
    const result = await this.conversationFavoritesService.addFavorite(
      body.username,
      body.conversationId,
    );

    //  Notificar sincronización
    this.socketGateway.notifyFavoriteChanged(body.username, {
      type: 'conv',
      conversationId: body.conversationId,
      isFavorite: true
    });

    return result;
  }

  // Quitar de favoritos
  @ApiBearerAuth()
  @Delete()
  async removeFavorite(
    @Body() body: { username: string; conversationId: number },
  ) {
    await this.conversationFavoritesService.removeFavorite(body.username, body.conversationId);

    //  Notificar sincronización
    this.socketGateway.notifyFavoriteChanged(body.username, {
      type: 'conv',
      conversationId: body.conversationId,
      isFavorite: false
    });

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

  //  NUEVO: Obtener favoritos con datos completos de la conversación
  @Get('full/:username')
  @ApiOperation({ summary: 'Obtener favoritos con datos embebidos de la conversación' })
  @ApiParam({ name: 'username' })
  @ApiResponse({ status: 200, description: 'Lista de favoritos con datos' })
  async getFullUserFavorites(@Param('username') username: string) {
    return await this.conversationFavoritesService.getUserFavoritesWithConversationData(username);
  }
}


