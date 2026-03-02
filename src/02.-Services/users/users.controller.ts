import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';

@ApiTags('users')
@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Get(':username')
    @ApiOperation({ summary: 'Obtener información de usuario por username' })
    @ApiParam({ name: 'username', description: 'Username (DNI) del usuario' })
    @ApiResponse({ status: 200, description: 'Usuario encontrado' })
    @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
    async findByUsername(@Param('username') username: string) {
        const user = await this.usersService.findByUsername(username);
        if (!user) {
            throw new NotFoundException(`Usuario con username ${username} no encontrado`);
        }
        return user;
    }
}
