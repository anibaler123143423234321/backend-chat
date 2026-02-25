import { Injectable } from '@nestjs/common';
import { User } from 'src/02.-Services/users/interfaces/user.interface';

@Injectable()
export class UsersService {
  async findByUsername(username: string): Promise<User | null> {
    // Este método se implementará cuando se conecte con la API del CRM
    // Por ahora retorna null para evitar errores
    return null;
  }

  async createOrUpdate(userData: any): Promise<User> {
    // Este método se implementará cuando se conecte con la API del CRM
    // Por ahora retorna un objeto mock para evitar errores
    return {
      id: userData.id || 0,
      username: userData.username || '',
      password: '',
      nombre: userData.nombre || '',
      apellido: userData.apellido || '',
      tipoTrabajo: userData.tipoTrabajo || '',
      email: userData.email || '',
      fechaCreacion: new Date(),
      estado: 'A',
      role: userData.role || 'ASESOR',
      picture: userData.picture || '',
      token: userData.token || '',
      sede_id: userData.sede_id || 0,
      sede: userData.sede || '',
      numeroAgente: userData.numeroAgente || null,
    } as User;
  }
}
