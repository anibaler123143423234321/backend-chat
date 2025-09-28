import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Patch,
  Request,
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
    console.log('🏠 TemporaryRoomsController initialized');
  }

  @Post()
  create(
    @Body() createDto: CreateTemporaryRoomDto,
    @Request() req,
  ): Promise<TemporaryRoomWithUrl> {
    console.log('📝 POST /api/temporary-rooms called with data:', createDto);
    console.log('👤 User ID from request:', req.user?.id);
    // Usar ID de usuario por defecto para pruebas (1)
    const userId = req.user?.id || 1;
    const creatorUsername =
      createDto.creatorUsername || req.user?.username || 'Usuario';
    console.log('👤 Creator username:', creatorUsername);
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

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.temporaryRoomsService.findOne(+id);
  }

  @Get('code/:roomCode')
  findByCode(@Param('roomCode') roomCode: string) {
    return this.temporaryRoomsService.findByRoomCode(roomCode);
  }

  @Get('admin/rooms')
  getAdminRooms(@Request() req) {
    // console.log('🔍 GET /api/temporary-rooms/admin/rooms called');
    const userId = req.user?.id || 1; // Usar ID por defecto para pruebas
    return this.temporaryRoomsService.getAdminRooms(userId);
  }

  @Get('user/current-room')
  getCurrentUserRoom(@Request() req) {
    // console.log('🔍 GET /api/temporary-rooms/user/current-room called');
    const userId = req.user?.id || 1; // Usar ID por defecto para pruebas
    return this.temporaryRoomsService.getCurrentUserRoom(userId);
  }

  @Get(':roomCode/users')
  getRoomUsers(@Param('roomCode') roomCode: string) {
    console.log('👥 GET /api/temporary-rooms/' + roomCode + '/users called');
    return this.temporaryRoomsService.getRoomUsers(roomCode);
  }

  @Patch(':id/duration')
  updateRoomDuration(
    @Param('id') id: string,
    @Body() updateDto: { duration: number },
    @Request() req,
  ) {
    console.log('⏰ PATCH /api/temporary-rooms/' + id + '/duration called');
    console.log('Nueva duración:', updateDto.duration, 'minutos');
    const userId = req.user?.id || 1; // Usar ID por defecto para pruebas
    return this.temporaryRoomsService.updateRoomDuration(
      +id,
      updateDto.duration,
      userId,
    );
  }

  @Post('join')
  joinRoom(@Body() joinDto: JoinRoomDto, @Request() req) {
    console.log('🚪 POST /api/temporary-rooms/join called with data:', joinDto);
    console.log('👤 Request user:', req.user);

    // Usar username del DTO o del request, con fallback
    const username = joinDto.username || req.user?.username || 'Usuario';
    console.log('👤 Username to use:', username);

    return this.temporaryRoomsService.joinRoom(joinDto, username);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    console.log('🗑️ DELETE /api/temporary-rooms/' + id + ' called');
    const userId = req.user?.id || 1; // Usar ID por defecto para pruebas
    return this.temporaryRoomsService.delete(+id, userId);
  }

  @Patch(':id/deactivate')
  deactivateRoom(@Param('id') id: string, @Request() req) {
    console.log('⏸️ PATCH /api/temporary-rooms/' + id + '/deactivate called');
    const userId = req.user?.id || 1; // Usar ID por defecto para pruebas
    return this.temporaryRoomsService.deactivateRoom(parseInt(id), userId);
  }
}
