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

@Controller('temporary-rooms')
// @UseGuards(JwtAuthGuard) // Temporalmente deshabilitado para pruebas
export class TemporaryRoomsController {
  constructor(private readonly temporaryRoomsService: TemporaryRoomsService) {
  }

  @Post()
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

  @Get()
  findAll() {
    return this.temporaryRoomsService.findAll();
  }

  @Get('user/list')
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
  getAdminRooms(
    @Request() req,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('displayName') displayName?: string,
    @Query('role') role?: string, // 👈 Recibir el rol
  ) {
    return this.temporaryRoomsService.getAdminRooms(page, limit, search, displayName, role);
  }

  @Get('user/current-room')
  getCurrentUserRoom(@Request() req, @Query('username') username?: string) {
    // Usar username del query param (displayName desde localStorage)
    return this.temporaryRoomsService.getCurrentUserRoomByUsername(username);
  }

  @Get('code/:roomCode')
  findByCode(@Param('roomCode') roomCode: string) {
    return this.temporaryRoomsService.findByRoomCode(roomCode);
  }

  // Rutas con parÃ¡metros AL FINAL
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.temporaryRoomsService.findOne(+id);
  }

  @Get(':roomCode/users')
  getRoomUsers(@Param('roomCode') roomCode: string) {
    return this.temporaryRoomsService.getRoomUsers(roomCode);
  }

  @Post('join')
  joinRoom(@Body() joinDto: JoinRoomDto, @Request() req) {

    // Usar username del DTO o del request, con fallback
    const username = joinDto.username || req.user?.username || 'Usuario';

    return this.temporaryRoomsService.joinRoom(joinDto, username);
  }

  @Post(':roomCode/remove-user')
  removeUserFromRoom(
    @Param('roomCode') roomCode: string,
    @Body() body: { username: string },
    @Request() req
  ) {
    return this.temporaryRoomsService.removeUserFromRoom(roomCode, body.username);
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
  async pinMessage(
    @Param('roomCode') roomCode: string,
    @Body() body: { messageId: number | null }
  ) {
    return this.temporaryRoomsService.updatePinnedMessage(roomCode, body.messageId);
  }

  @Post(':roomCode/approve-join')
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
}
