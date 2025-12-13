import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Token no proporcionado');
    }

    try {
      // Validar el token con el Backend Java (CRM)
      const response = await fetch(process.env.CRM_REFRESH_TOKEN_URL, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error(`[JwtAuthGuard] Backend Java respondió con status ${response.status}`);
        const errorText = await response.text();
        console.error(`[JwtAuthGuard] Error del Backend Java: ${errorText}`);
        throw new UnauthorizedException('Token inválido');
      }

      const userData = await response.json();
      console.log('[JwtAuthGuard] Respuesta del Backend Java:', JSON.stringify(userData));

      if (userData.rpta !== 1) {
        console.error('[JwtAuthGuard] Backend Java rechazó el token, rpta:', userData.rpta);
        throw new UnauthorizedException('Token inválido');
      }

      // Adjuntar los datos del usuario a la request
      request['user'] = {
        username: userData.data.username || userData.data.usuario,
        id: userData.data.id,
        role: userData.data.role || userData.data.rol || 'ASESOR',
        ...userData.data,
      };

      console.log('[JwtAuthGuard] Token validado exitosamente para usuario:', request['user'].username);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      console.error('[JwtAuthGuard] Error al validar token:', error.message);
      throw new UnauthorizedException('Token inválido o expirado');
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
