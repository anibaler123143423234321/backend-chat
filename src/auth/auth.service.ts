import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { User } from '../users/interfaces/user.interface';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async validateToken(token: string): Promise<User> {
    try {
      // Verificar el token con el CRM existente
      const response = await fetch(process.env.CRM_REFRESH_TOKEN_URL, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new UnauthorizedException('Token inválido');
      }

      const userData = await response.json();

      if (userData.rpta !== 1) {
        throw new UnauthorizedException('Token inválido');
      }

      // Crear usuario desde los datos del CRM
      const user = await this.usersService.createOrUpdate(userData.data);
      return user;
    } catch (error) {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }

  async generateJwtToken(user: User): Promise<string> {
    const payload = {
      username: user.username,
      sub: user.id,
      role: user.role || 'ASESOR',
    };
    return this.jwtService.sign(payload);
  }
}
