import { Injectable } from '@nestjs/common';
import { Role } from '../users/interfaces/user.interface';

@Injectable()
export class RolesService {
  async findAll(): Promise<Role[]> {
    // Retorna todos los roles disponibles del CRM
    return Object.values(Role);
  }

  async findOne(id: number): Promise<Role | null> {
    // Este método se implementará cuando se conecte con la API del CRM
    return null;
  }

  async findByName(name: string): Promise<Role | null> {
    // Busca el rol por nombre en el enum
    const role = Object.values(Role).find((r) => r === name);
    return role || null;
  }
}
