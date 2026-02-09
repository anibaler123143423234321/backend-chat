import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) { }

  @Post('validate-token')
  async validateToken(@Body() body: { token: string }) {
    const user = await this.authService.validateToken(body.token);
    const jwtToken = await this.authService.generateJwtToken(user);

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        nombre: user.nombre,
        apellido: user.apellido,
        email: user.email,
        role: user.role || 'USER',
        sede: user.sede,
        sede_id: user.sede_id,
        picture: user.foto,
      },
      token: jwtToken,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('refresh')
  async refresh(@Request() req) {
    const user = await this.authService.validateToken(
      req.headers.authorization?.replace('Bearer ', ''),
    );
    const jwtToken = await this.authService.generateJwtToken(user);

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        nombre: user.nombre,
        apellido: user.apellido,
        email: user.email,
        role: user.role || 'USER',
        sede: user.sede,
        sede_id: user.sede_id,
        picture: user.foto,
      },
      token: jwtToken,
    };
  }
}
