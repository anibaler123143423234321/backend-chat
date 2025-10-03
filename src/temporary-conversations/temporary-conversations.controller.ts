import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Request,
} from '@nestjs/common';
import { TemporaryConversationsService } from './temporary-conversations.service';
import { CreateTemporaryConversationDto } from './dto/create-temporary-conversation.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('temporary-conversations')
// @UseGuards(JwtAuthGuard) // Temporalmente deshabilitado - autenticación por socket
export class TemporaryConversationsController {
  constructor(
    private readonly temporaryConversationsService: TemporaryConversationsService,
  ) {}

  @Post()
  create(@Body() createDto: CreateTemporaryConversationDto, @Request() req) {
    const userId = req.user?.id || 1;
    return this.temporaryConversationsService.create(createDto, userId);
  }

  @Get()
  findAll() {
    return this.temporaryConversationsService.findAll();
  }

  @Get('my-conversations')
  findMyConversations(@Request() req) {
    // Obtener username del query param si no hay usuario autenticado
    const username = req.user?.username || req.query.username;
    if (!username) {
      throw new Error('Username es requerido');
    }
    return this.temporaryConversationsService.findByUser(username);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.temporaryConversationsService.findOne(+id);
  }

  @Post('admin-assign')
  createAdminAssignedConversation(
    @Body() body: { user1: string; user2: string; name: string },
    @Request() req,
  ) {
    // Validar que el usuario sea admin
    if (req.user.role !== 'ADMIN') {
      throw new Error('Solo los administradores pueden crear conversaciones asignadas');
    }

    return this.temporaryConversationsService.createAdminAssignedConversation(
      body.user1,
      body.user2,
      body.name,
      req.user.id,
    );
  }

  @Post('join/:linkId')
  joinConversation(@Param('linkId') linkId: string, @Request() req) {
    return this.temporaryConversationsService.joinConversation(
      linkId,
      req.user.username,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.temporaryConversationsService.remove(+id, req.user.id);
  }
}
