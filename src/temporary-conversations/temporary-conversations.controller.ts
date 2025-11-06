import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Delete,
  Patch,
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

  @Get('all')
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

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updateData: { name?: string; expiresAt?: Date },
  ) {
    return this.temporaryConversationsService.update(+id, updateData);
  }

  @Post('admin-assign')
  createAdminAssignedConversation(
    @Body()
    body: {
      user1: string;
      user2: string;
      name: string;
      adminId: number;
      adminRole: string;
    },
  ) {
    // Validar que el usuario sea admin
    if (body.adminRole !== 'ADMIN') {
      throw new Error(
        'Solo los administradores pueden crear conversaciones asignadas',
      );
    }

    return this.temporaryConversationsService.createAdminAssignedConversation(
      body.user1,
      body.user2,
      body.name,
      body.adminId,
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
    const userId = req.user?.id;
    return this.temporaryConversationsService.remove(+id, userId);
  }

  @Patch(':id/deactivate')
  deactivateConversation(@Param('id') id: string, @Request() req) {
    console.log('⏸️ PATCH /api/temporary-conversations/' + id + '/deactivate called');
    const userId = req.user?.id || 1;
    return this.temporaryConversationsService.deactivateConversation(parseInt(id), userId);
  }

  @Patch(':id/activate')
  activateConversation(@Param('id') id: string, @Request() req) {
    console.log('▶️ PATCH /api/temporary-conversations/' + id + '/activate called');
    const userId = req.user?.id || 1;
    return this.temporaryConversationsService.activateConversation(parseInt(id), userId);
  }
}
