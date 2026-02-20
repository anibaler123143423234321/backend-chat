import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Patch,
  Request,
  Query,
} from '@nestjs/common';
import {
  TemporaryRoomsService,
  TemporaryRoomWithUrl,
} from './temporary-rooms.service';
import { CreateTemporaryRoomDto } from './dto/create-temporary-room.dto';
import { JoinRoomDto } from './dto/join-room.dto';

import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';

@ApiTags('Salas y Grupos')
@ApiBearerAuth()
@Controller('temporary-rooms')
// @UseGuards(JwtAuthGuard) // Temporalmente deshabilitado para pruebas
export class TemporaryRoomsController {
  constructor(private readonly temporaryRoomsService: TemporaryRoomsService) {
  }

  @Post()
  @ApiOperation({ summary: 'Crear una nueva sala temporal' })
  @ApiResponse({ status: 201, description: 'Sala creada con éxito' })
  create(
    @Body() createDto: CreateTemporaryRoomDto,
    @Request() req,
  ): Promise<TemporaryRoomWithUrl> {
    // Usar ID de usuario por defecto para pruebas (1)
    const userId = req.user?.id || 1;
    const creatorUsername =
      createDto.creatorUsername || req.user?.username || 'Usuario';
    return this.temporaryRoomsService.create(
      createDto,
      userId,
      creatorUsername,
    );
  }

  @Get('all')
  @ApiOperation({ summary: 'Obtener todas las salas paginadas (Admin Modal)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiResponse({ status: 200, description: 'Lista de salas paginada' })
  findAllPaginated(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('search') search?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(50, parseInt(limit) || 10));
    return this.temporaryRoomsService.findAllPaginated(pageNum, limitNum, search);
  }

  @Get()
  findAll() {
    return this.temporaryRoomsService.findAll();
  }

  @Get('user/list')
  @ApiOperation({ summary: 'Obtener salas de un usuario' })
  @ApiQuery({ name: 'username', description: 'Username del usuario' })
  @ApiQuery({ name: 'page', required: false, description: 'Página' })
  @ApiQuery({ name: 'limit', required: false, description: 'Límite' })
  @ApiQuery({ name: 'search', required: false, description: 'Término de búsqueda' })
  @ApiResponse({ status: 200, description: 'Lista de salas' })
  findUserRooms(
    @Query('username') username: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('search') search?: string, // 🔥 NUEVO: Parámetro de búsqueda
  ) {
    if (!username) {
      throw new Error('Username es requerido');
    }
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(50, parseInt(limit) || 10)); // Máximo 50 por página
    return this.temporaryRoomsService.findUserRooms(username, pageNum, limitNum, search);
  }

  @Get('admin/rooms')
  @ApiOperation({ summary: 'Obtener todas las salas (Vista Admin)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'displayName', required: false })
  @ApiQuery({ name: 'role', required: false })
  @ApiQuery({ name: 'username', required: false }) // 👈 Nuevo parámetro para filtrar favoritos correctamente
  @ApiResponse({ status: 200, description: 'Lista de salas administrativa' })
  getAdminRooms(
    @Request() req,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('displayName') displayName?: string,
    @Query('role') role?: string,
    @Query('username') username?: string, // 👈 Recibir username
  ) {
    // Priorizar username del query, luego del token (req.user)
    const finalUsername = username || req.user?.username;
    return this.temporaryRoomsService.getAdminRooms(page, limit, search, displayName, role, finalUsername);
  }

  @Get('user/current-room')
  @ApiOperation({ summary: 'Obtener la sala actual del usuario' })
  @ApiQuery({ name: 'username', required: false })
  @ApiResponse({ status: 200, description: 'Sala actual' })
  getCurrentUserRoom(@Request() req, @Query('username') username?: string) {
    // Usar username del query param (displayName desde localStorage)
    return this.temporaryRoomsService.getCurrentUserRoomByUsername(username);
  }

  @Get('code/:roomCode')
  @ApiOperation({ summary: 'Buscar sala por código' })
  @ApiParam({ name: 'roomCode', description: 'Código único de la sala' })
  @ApiResponse({ status: 200, description: 'Datos de la sala' })
  findByCode(@Param('roomCode') roomCode: string) {
    return this.temporaryRoomsService.findByRoomCode(roomCode);
  }

  // Rutas con parÃ¡metros AL FINAL
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.temporaryRoomsService.findOne(+id);
  }

  @Get(':roomCode/users')
  @ApiOperation({ summary: 'Obtener usuarios de una sala' })
  @ApiParam({ name: 'roomCode' })
  @ApiResponse({ status: 200, description: 'Lista de usuarios' })
  getRoomUsers(@Param('roomCode') roomCode: string) {
    return this.temporaryRoomsService.getRoomUsers(roomCode);
  }

  @Post('join')
  @ApiOperation({ summary: 'Unirse a una sala' })
  @ApiBody({ type: JoinRoomDto })
  @ApiResponse({ status: 201, description: 'Usuario unido a la sala' })
  joinRoom(@Body() joinDto: JoinRoomDto, @Request() req) {

    // Usar username del DTO o del request, con fallback
    const username = joinDto.username || req.user?.username || 'Usuario';

    return this.temporaryRoomsService.joinRoom(joinDto, username);
  }

  @Post(':roomCode/remove-user')
  @ApiOperation({ summary: 'Remover usuario de una sala' })
  @ApiParam({ name: 'roomCode' })
  @ApiBody({ schema: { type: 'object', properties: { username: { type: 'string' }, removedBy: { type: 'string', required: ['false'] } } } })
  @ApiResponse({ status: 200, description: 'Usuario removido' })
  removeUserFromRoom(
    @Param('roomCode') roomCode: string,
    @Body() body: { username: string; removedBy?: string },
    @Request() req
  ) {
    // Capturar quién realiza la eliminación para auditoría
    const removedBy = body.removedBy || req.user?.displayName || req.user?.username || 'Administrador';
    return this.temporaryRoomsService.removeUserFromRoom(roomCode, body.username, removedBy);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    const userId = req.user?.id || 1; // Usar ID por defecto para pruebas
    return this.temporaryRoomsService.delete(+id, userId);
  }

  @Patch(':id/deactivate')
  deactivateRoom(@Param('id') id: string, @Request() req) {
    const userId = req.user?.id || 1; // Usar ID por defecto para pruebas
    return this.temporaryRoomsService.deactivateRoom(parseInt(id), userId);
  }

  @Patch(':id/activate')
  activateRoom(@Param('id') id: string, @Request() req) {
    const userId = req.user?.id || 1; // Usar ID por defecto para pruebas
    return this.temporaryRoomsService.activateRoom(parseInt(id), userId);
  }

  @Patch(':id/update')
  @ApiOperation({ summary: 'Actualizar datos de una sala' })
  @ApiParam({ name: 'id' })
  @ApiBody({ schema: { type: 'object', properties: { maxCapacity: { type: 'number' }, picture: { type: 'string' }, description: { type: 'string' } } } })
  @ApiResponse({ status: 200, description: 'Sala actualizada' })
  updateRoom(
    @Param('id') id: string,
    @Body() updateData: { maxCapacity?: number; picture?: string; description?: string },
    @Request() req
  ) {
    const userId = req.user?.id || 1; // Usar ID por defecto para pruebas
    return this.temporaryRoomsService.updateRoom(parseInt(id), userId, updateData);
  }

  @Get(':roomCode/pinned-message')
  async getPinnedMessage(@Param('roomCode') roomCode: string) {
    const pinnedId = await this.temporaryRoomsService.getPinnedMessage(roomCode);
    return { pinnedMessageId: pinnedId };
  }

  @Patch(':roomCode/pin-message')
  @ApiOperation({ summary: 'Fijar un mensaje en la sala' })
  @ApiParam({ name: 'roomCode' })
  @ApiBody({ schema: { type: 'object', properties: { messageId: { type: 'number', nullable: true } } } })
  @ApiResponse({ status: 200, description: 'Mensaje fijado' })
  async pinMessage(
    @Param('roomCode') roomCode: string,
    @Body() body: { messageId: number | null }
  ) {
    return this.temporaryRoomsService.updatePinnedMessage(roomCode, body.messageId);
  }

  @Post(':roomCode/approve-join')
  @ApiOperation({ summary: 'Aprobar solicitud de unión a sala' })
  @ApiParam({ name: 'roomCode' })
  @ApiBody({ schema: { type: 'object', properties: { username: { type: 'string' }, approverUsername: { type: 'string', required: ['false'] } } } })
  @ApiResponse({ status: 200, description: 'Solicitud aprobada' })
  approveJoinRequest(
    @Param('roomCode') roomCode: string,
    @Body() body: { username: string; approverUsername?: string },
    @Request() req
  ) {
    // Si no viene el aprobador en el body, intentar sacarlo del token
    const approver = body.approverUsername || req.user?.username || 'Admin';
    return this.temporaryRoomsService.approveJoinRequest(roomCode, body.username, approver);
  }

  @Post(':roomCode/add-user')
  addUserDirectly(
    @Param('roomCode') roomCode: string,
    @Body() body: { username: string },
    @Request() req
  ) {
    // Este endpoint permite a admins agregar usuarios directamente sin pasar por pending
    return this.temporaryRoomsService.addMemberDirectly(roomCode, body.username);
  }

  @Post(':roomCode/reject-join')
  rejectJoinRequest(
    @Param('roomCode') roomCode: string,
    @Body() body: { username: string },
  ) {
    return this.temporaryRoomsService.rejectJoinRequest(roomCode, body.username);
  }

  @Post(':roomCode/mute')
  muteRoom(
    @Param('roomCode') roomCode: string,
    @Body() body: { username: string }
  ) {
    return this.temporaryRoomsService.muteRoom(roomCode, body.username);
  }

  @Post(':roomCode/unmute')
  @ApiOperation({ summary: 'Quitar silencio (unmute) de una sala para el usuario' })
  @ApiParam({ name: 'roomCode' })
  @ApiBody({ schema: { type: 'object', properties: { username: { type: 'string' } } } })
  @ApiResponse({ status: 200, description: 'Sala con sonido' })
  unmuteRoom(
    @Param('roomCode') roomCode: string,
    @Body() body: { username: string }
  ) {
    return this.temporaryRoomsService.unmuteRoom(roomCode, body.username);
  }
}
