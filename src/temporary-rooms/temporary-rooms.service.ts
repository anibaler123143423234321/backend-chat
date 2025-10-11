import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TemporaryRoom } from './entities/temporary-room.entity';
import { CreateTemporaryRoomDto } from './dto/create-temporary-room.dto';
import { JoinRoomDto } from './dto/join-room.dto';
import { User } from '../users/entities/user.entity';
import { randomBytes } from 'crypto';

export interface TemporaryRoomWithUrl {
  id: number;
  name: string;
  roomCode: string;
  maxCapacity: number;
  currentMembers: number;
  roomUrl: string;
  createdAt: Date;
  isActive: boolean;
}

@Injectable()
export class TemporaryRoomsService {
  constructor(
    @InjectRepository(TemporaryRoom)
    private temporaryRoomRepository: Repository<TemporaryRoom>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async create(
    createDto: CreateTemporaryRoomDto,
    userId: number,
    creatorUsername?: string,
  ): Promise<TemporaryRoomWithUrl> {
    // console.log('Creando sala temporal con datos:', createDto);
    // console.log('Usuario ID:', userId);
    // console.log('Nombre del creador:', creatorUsername);

    const roomCode = this.generateRoomCode();
    const expiresAt = new Date();
    // Las salas ahora son permanentes (sin expiración automática)
    expiresAt.setFullYear(expiresAt.getFullYear() + 10); // Expira en 10 años

    // console.log('Código de sala generado:', roomCode);
    // console.log('Fecha de expiración:', expiresAt);

    // Inicializar con el creador como primer miembro
    const members = creatorUsername ? [creatorUsername] : []; // Historial
    const connectedMembers = creatorUsername ? [creatorUsername] : []; // Conectados actualmente
    const currentMembers = creatorUsername ? 1 : 0;

    const room = this.temporaryRoomRepository.create({
      ...createDto,
      roomCode,
      expiresAt,
      createdBy: userId,
      currentMembers,
      members,
      connectedMembers,
      isActive: true,
    });

    // console.log('Sala creada en memoria:', room);

    const savedRoom = await this.temporaryRoomRepository.save(room);
    // console.log('Sala guardada en BD:', savedRoom);

    // Generar URL de la sala
    //const roomUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/#/room/${savedRoom.roomCode}`;
    const roomUrl = `${process.env.FRONTEND_URL || 'https://chat.mass34.com'}/#/room/${savedRoom.roomCode}`;
    // console.log('URL generada:', roomUrl);

    // Crear respuesta limpia con solo los campos necesarios
    const result = {
      id: savedRoom.id,
      name: savedRoom.name,
      roomCode: savedRoom.roomCode,
      maxCapacity: savedRoom.maxCapacity,
      currentMembers: savedRoom.currentMembers,
      roomUrl: roomUrl,
      createdAt: savedRoom.createdAt,
      isActive: savedRoom.isActive,
    };

    // console.log('Resultado final a devolver:', result);
    return result;
  }

  async findAll(): Promise<TemporaryRoom[]> {
    return await this.temporaryRoomRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<TemporaryRoom> {
    const room = await this.temporaryRoomRepository.findOne({
      where: { id, isActive: true },
    });

    if (!room) {
      throw new NotFoundException('Sala temporal no encontrada');
    }

    return room;
  }

  async findByRoomCode(roomCode: string): Promise<TemporaryRoom> {
    const room = await this.temporaryRoomRepository.findOne({
      where: { roomCode, isActive: true },
    });

    if (!room) {
      throw new NotFoundException('Código de sala no válido');
    }

    if (new Date() > room.expiresAt) {
      throw new BadRequestException('La sala ha expirado');
    }

    return room;
  }

  async joinRoom(
    joinDto: JoinRoomDto,
    username: string,
  ): Promise<TemporaryRoom> {
    // console.log('🔍 Buscando sala con código:', joinDto.roomCode);
    // console.log('👤 Usuario que se une:', username);

    const room = await this.findByRoomCode(joinDto.roomCode);
    // console.log('🏠 Sala encontrada:', room);

    if (room.currentMembers >= room.maxCapacity) {
      throw new BadRequestException('La sala ha alcanzado su capacidad máxima');
    }

    if (!room.members) {
      room.members = [];
    }
    if (!room.connectedMembers) {
      room.connectedMembers = [];
    }

    // Agregar al historial si no está
    if (!room.members.includes(username)) {
      room.members.push(username);
    }

    // Si el usuario ya está conectado, no hacer nada
    if (room.connectedMembers.includes(username)) {
      // console.log('👤 Usuario ya está conectado en la sala');
      return room;
    }

    // Si hay un "Usuario" genérico en connectedMembers, reemplazarlo
    const genericUserIndex = room.connectedMembers.indexOf('Usuario');
    if (genericUserIndex !== -1) {
      room.connectedMembers[genericUserIndex] = username;
      // console.log('🔄 Reemplazando "Usuario" genérico con:', username);
    } else {
      // Agregar a usuarios conectados
      room.connectedMembers.push(username);
    }

    room.currentMembers = room.connectedMembers.length;
    // console.log('👥 Usuarios conectados en la sala:', room.connectedMembers);
    // console.log('📜 Historial de usuarios:', room.members);
    await this.temporaryRoomRepository.save(room);

    // console.log('✅ Usuario unido exitosamente a la sala');
    return room;
  }

  async leaveRoom(roomCode: string, username: string): Promise<TemporaryRoom> {
    // console.log('🚪 Usuario saliendo de la sala:', username, 'de', roomCode);

    const room = await this.findByRoomCode(roomCode);

    // 🔥 NUEVO: Validar si el usuario está asignado por un admin
    if (room.isAssignedByAdmin && room.assignedMembers && room.assignedMembers.includes(username)) {
      throw new BadRequestException(
        'No puedes salir de esta sala porque fuiste asignado por un administrador'
      );
    }

    if (!room.connectedMembers) {
      room.connectedMembers = [];
    }

    // Remover el usuario solo de connectedMembers (mantener en historial)
    const userIndex = room.connectedMembers.indexOf(username);
    if (userIndex !== -1) {
      room.connectedMembers.splice(userIndex, 1);
      room.currentMembers = room.connectedMembers.length;

      // console.log('👥 Usuarios conectados después de salir:', room.connectedMembers);
      // console.log('📜 Historial de usuarios (sin cambios):', room.members);
      await this.temporaryRoomRepository.save(room);
      // console.log('✅ Usuario desconectado de la sala en BD');
    } else {
      // console.log('❌ Usuario no encontrado en connectedMembers');
    }

    // Limpiar la sala actual del usuario en la base de datos
    try {
      const user = await this.userRepository.findOne({ where: { username } });
      if (user && user.currentRoomCode === roomCode) {
        user.currentRoomCode = null;
        await this.userRepository.save(user);
        // console.log('✅ Sala actual del usuario limpiada en BD');
      }
    } catch (error) {
      // console.error('❌ Error al limpiar sala actual del usuario:', error);
    }

    return room;
  }

  async remove(id: number, userId: number): Promise<void> {
    const room = await this.findOne(id);

    if (room.createdBy !== userId) {
      throw new BadRequestException(
        'No tienes permisos para eliminar esta sala',
      );
    }

    room.isActive = false;
    await this.temporaryRoomRepository.save(room);
  }

  async delete(id: number, userId: number): Promise<void> {
    // console.log(
    //   '🗑️ Eliminando permanentemente sala:',
    //   id,
    //   'por usuario:',
    //   userId,
    // );
    const room = await this.temporaryRoomRepository.findOne({
      where: { id, createdBy: userId },
    });
    if (!room) {
      // console.log('❌ Sala no encontrada o no pertenece al usuario');
      throw new NotFoundException(
        'Sala no encontrada o no tienes permisos para eliminarla',
      );
    }
    // console.log('✅ Sala encontrada, eliminando permanentemente:', room.name);
    await this.temporaryRoomRepository.remove(room);
    // console.log('✅ Sala eliminada permanentemente');
  }

  async getAdminRooms(userId: number): Promise<any[]> {
    // console.log('🔍 Obteniendo salas del admin:', userId);
    const rooms = await this.temporaryRoomRepository.find({
      where: { createdBy: userId },
      order: { createdAt: 'DESC' },
    });
    // console.log('📋 Salas encontradas:', rooms.length);

    // Usar la duración guardada en la base de datos
    return rooms;
  }

  async deactivateRoom(id: number, userId: number): Promise<TemporaryRoom> {
    // console.log('⏸️ Desactivando sala:', id, 'por usuario:', userId);
    const room = await this.temporaryRoomRepository.findOne({
      where: { id, createdBy: userId },
    });
    if (!room) {
      throw new NotFoundException('Sala no encontrada');
    }

    room.isActive = false;
    const updatedRoom = await this.temporaryRoomRepository.save(room);
    // console.log('✅ Sala desactivada:', updatedRoom.name);
    return updatedRoom;
  }

  async getCurrentUserRoom(userId: number): Promise<any> {
    // console.log('🔍 Buscando sala actual del usuario:', userId);

    try {
      // Buscar salas donde el usuario es miembro
      const rooms = await this.temporaryRoomRepository
        .createQueryBuilder('room')
        .where('room.createdBy = :userId', { userId })
        .andWhere('room.isActive = :isActive', { isActive: true })
        .getMany();

      if (rooms.length === 0) {
        // console.log('❌ Usuario no está en ninguna sala');
        return { inRoom: false, room: null };
      }

      // Por ahora, devolver la primera sala activa
      const currentRoom = rooms[0];
      // console.log('✅ Usuario está en sala:', currentRoom.name);

      return {
        inRoom: true,
        room: {
          id: currentRoom.id,
          name: currentRoom.name,
          roomCode: currentRoom.roomCode,
          maxCapacity: currentRoom.maxCapacity,
          currentMembers: currentRoom.currentMembers,
          isActive: currentRoom.isActive,
          expiresAt: currentRoom.expiresAt,
        },
      };
    } catch (error) {
      // console.error('❌ Error de conexión a la base de datos:', error);
      // En caso de error de BD, devolver que no está en ninguna sala
      // para que la aplicación pueda continuar funcionando
      return {
        inRoom: false,
        room: null,
        error: 'Database connection error',
      };
    }
  }

  async getRoomUsers(roomCode: string): Promise<any> {
    // console.log('👥 Obteniendo usuarios de la sala:', roomCode);

    const room = await this.temporaryRoomRepository.findOne({
      where: { roomCode, isActive: true },
    });

    if (!room) {
      throw new NotFoundException('Sala no encontrada o inactiva');
    }

    // Obtener historial completo de usuarios
    const allUsers = room.members || [];
    const connectedUsers = room.connectedMembers || [];

    // Crear lista con todos los usuarios del historial y su estado de conexión
    let userList = [];
    if (allUsers.length > 0) {
      userList = allUsers.map((username, index) => ({
        id: index + 1,
        username: username,
        displayName: username === 'Usuario' ? `Usuario ${index + 1}` : username,
        isOnline: connectedUsers.includes(username), // true si está en connectedMembers
      }));
    } else if (room.currentMembers > 0) {
      // Si hay miembros pero no en el array, crear usuarios genéricos
      for (let i = 1; i <= room.currentMembers; i++) {
        userList.push({
          id: i,
          username: `Usuario ${i}`,
          displayName: `Usuario ${i}`,
          isOnline: true,
        });
      }
    }

    // console.log('✅ Usuarios en la sala (historial):', userList);

    return {
      roomCode: room.roomCode,
      roomName: room.name,
      users: userList,
      totalUsers: userList.length,
      maxCapacity: room.maxCapacity,
    };
  }

  private generateRoomCode(): string {
    return randomBytes(4).toString('hex').toUpperCase();
  }
}
