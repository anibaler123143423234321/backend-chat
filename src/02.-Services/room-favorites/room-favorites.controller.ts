import { Controller, Post, Delete, Get, Body, Param, Query, UseGuards } from '@nestjs/common';
import { RoomFavoritesService } from 'src/02.-Services/room-favorites/room-favorites.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiBody, ApiQuery } from '@nestjs/swagger';
import { SocketGateway } from 'src/03.-Socket/socket/socket.gateway';

@ApiTags('Favoritos (Salas)')
@Controller('room-favorites')
export class RoomFavoritesController {
  constructor(
    private readonly roomFavoritesService: RoomFavoritesService,
    private readonly socketGateway: SocketGateway,
  ) { }

  // Alternar favorito (agregar o quitar)
  @ApiBearerAuth()
  @Post('toggle')
  @ApiOperation({ summary: 'Alternar estado de favorito en una sala (agregar/quitar)' })
  @ApiBody({ schema: { type: 'object', properties: { username: { type: 'string' }, roomCode: { type: 'string' }, roomId: { type: 'number' } } } })
  @ApiResponse({ status: 200, description: 'Estado alternado' })
  async toggleFavorite(
    @Body() body: { username: string; roomCode: string; roomId: number },
  ) {
    const result = await this.roomFavoritesService.toggleFavorite(
      body.username,
      body.roomCode,
      body.roomId,
    );

    //  Notificar sincronización
    this.socketGateway.notifyFavoriteChanged(body.username, {
      type: 'room',
      roomCode: body.roomCode,
      isFavorite: result.isFavorite
    });

    return result;
  }

  // Agregar a favoritos
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Agregar una sala a favoritos' })
  @ApiBody({ schema: { type: 'object', properties: { username: { type: 'string' }, roomCode: { type: 'string' }, roomId: { type: 'number' } } } })
  @ApiResponse({ status: 201, description: 'Agregado a favoritos' })
  async addFavorite(
    @Body() body: { username: string; roomCode: string; roomId: number },
  ) {
    const result = await this.roomFavoritesService.addFavorite(
      body.username,
      body.roomCode,
      body.roomId,
    );

    //  Notificar sincronización
    this.socketGateway.notifyFavoriteChanged(body.username, {
      type: 'room',
      roomCode: body.roomCode,
      isFavorite: true
    });

    return result;
  }

  // Quitar de favoritos
  @ApiBearerAuth()
  @Delete()
  async removeFavorite(
    @Body() body: { username: string; roomCode: string },
  ) {
    await this.roomFavoritesService.removeFavorite(body.username, body.roomCode);

    //  Notificar sincronización
    this.socketGateway.notifyFavoriteChanged(body.username, {
      type: 'room',
      roomCode: body.roomCode,
      isFavorite: false
    });

    return { message: 'Favorito eliminado' };
  }

  // Obtener favoritos de un usuario
  @Get('user/:username')
  @ApiOperation({ summary: 'Obtener salas favoritas de un usuario' })
  @ApiParam({ name: 'username' })
  @ApiResponse({ status: 200, description: 'Lista de salas favoritas' })
  async getUserFavorites(@Param('username') username: string) {
    return await this.roomFavoritesService.getUserFavorites(username);
  }

  // Verificar si una sala es favorita
  @Get('check')
  @ApiOperation({ summary: 'Verificar si una sala es favorita para el usuario' })
  @ApiQuery({ name: 'username' })
  @ApiQuery({ name: 'roomCode' })
  @ApiResponse({ status: 200, description: 'Estado de favorito' })
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

  //  NUEVO: Obtener favoritos con datos completos de la sala
  @Get('full/:username')
  @ApiOperation({ summary: 'Obtener favoritos con datos embebidos de la sala' })
  @ApiParam({ name: 'username' })
  @ApiResponse({ status: 200, description: 'Lista de favoritos con datos' })
  async getUserFavoritesWithData(@Param('username') username: string) {
    return await this.roomFavoritesService.getUserFavoritesWithRoomData(username);
  }
}


