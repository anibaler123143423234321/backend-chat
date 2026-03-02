import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User as UserEntity } from 'src/02.-Services/users/entities/user.entity';
import { User as UserInterface } from 'src/02.-Services/users/interfaces/user.interface';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) { }

  async findByUsername(username: string): Promise<UserEntity | null> {
    if (!username) return null;
    return await this.userRepository.findOne({ where: { username } });
  }

  async createOrUpdate(userData: any): Promise<UserEntity> {
    const username = userData.username;
    let user = await this.findByUsername(username);

    const updateData = {
      username: userData.username,
      nombre: userData.nombre,
      apellido: userData.apellido,
      email: userData.email,
      role: userData.role,
      picture: userData.picture,
      sede: userData.sede,
      sede_id: userData.sede_id,
      numeroAgente: userData.numeroAgente,
      tipoTrabajo: userData.tipoTrabajo,
    };

    if (user) {
      await this.userRepository.update(user.id, updateData);
      return await this.findByUsername(username);
    } else {
      const newUser = this.userRepository.create(updateData);
      return await this.userRepository.save(newUser);
    }
  }
}
