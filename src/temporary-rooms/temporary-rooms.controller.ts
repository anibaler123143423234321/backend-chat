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
  ) {
    if (!username) {
      throw new Error('Username es requerido');
    }
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(50, parseInt(limit) || 10)); // Máximo 50 por página
    return this.temporaryRoomsService.findUserRooms(username, pageNum, limitNum);
  }

  // Rutas especÃ­ficas ANTES de rutas con parÃ¡metros
  @Get('admin/rooms')
  getAdminRooms(
    @Request() req,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('username') username?: string,
  ) {
    // console.log('ðŸ” GET /api/temporary-rooms/admin/rooms called');
    const userId = req.user?.id || 1; // Usar ID por defecto para pruebas
    return this.temporaryRoomsService.getAdminRooms(userId, page, limit, search, username);
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
    @Body() updateData: { maxCapacity?: number },
    @Request() req
  ) {
    const userId = req.user?.id || 1; // Usar ID por defecto para pruebas
    return this.temporaryRoomsService.updateRoom(parseInt(id), userId, updateData);
  }
}
