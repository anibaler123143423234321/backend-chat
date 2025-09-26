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
  ) {}

  async create(
    createDto: CreateTemporaryRoomDto,
    userId: number,
  ): Promise<TemporaryRoomWithUrl> {
    console.log('Creando sala temporal con datos:', createDto);
    console.log('Usuario ID:', userId);

    const roomCode = this.generateRoomCode();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 horas por defecto

    console.log('Código de sala generado:', roomCode);
    console.log('Fecha de expiración:', expiresAt);

    const room = this.temporaryRoomRepository.create({
      ...createDto,
      roomCode,
      expiresAt,
      createdBy: userId,
      currentMembers: 0,
      isActive: true,
    });

    console.log('Sala creada en memoria:', room);

    const savedRoom = await this.temporaryRoomRepository.save(room);
    console.log('Sala guardada en BD:', savedRoom);

    // Generar URL de la sala
    const roomUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/#/room/${savedRoom.roomCode}`;
    console.log('URL generada:', roomUrl);

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

    console.log('Resultado final a devolver:', result);
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
    console.log('🔍 Buscando sala con código:', joinDto.roomCode);
    console.log('👤 Usuario que se une:', username);

    const room = await this.findByRoomCode(joinDto.roomCode);
    console.log('🏠 Sala encontrada:', room);

    if (room.currentMembers >= room.maxCapacity) {
      throw new BadRequestException('La sala ha alcanzado su capacidad máxima');
    }

    if (!room.members) {
      room.members = [];
    }

    if (!room.members.includes(username)) {
      room.members.push(username);
      room.currentMembers = room.members.length;
      console.log(
        '👥 Agregando usuario a la sala. Miembros actuales:',
        room.members,
      );
      await this.temporaryRoomRepository.save(room);
    }

    console.log('✅ Usuario unido exitosamente a la sala');
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
    console.log(
      '🗑️ Eliminando permanentemente sala:',
      id,
      'por usuario:',
      userId,
    );
    const room = await this.temporaryRoomRepository.findOne({
      where: { id, createdBy: userId },
    });
    if (!room) {
      console.log('❌ Sala no encontrada o no pertenece al usuario');
      throw new NotFoundException(
        'Sala no encontrada o no tienes permisos para eliminarla',
      );
    }
    console.log('✅ Sala encontrada, eliminando permanentemente:', room.name);
    await this.temporaryRoomRepository.remove(room);
    console.log('✅ Sala eliminada permanentemente');
  }

  async getAdminRooms(userId: number): Promise<TemporaryRoom[]> {
    console.log('🔍 Obteniendo salas del admin:', userId);
    const rooms = await this.temporaryRoomRepository.find({
      where: { createdBy: userId },
      order: { createdAt: 'DESC' },
    });
    console.log('📋 Salas encontradas:', rooms.length);
    return rooms;
  }

  async deactivateRoom(id: number, userId: number): Promise<TemporaryRoom> {
    console.log('⏸️ Desactivando sala:', id, 'por usuario:', userId);
    const room = await this.temporaryRoomRepository.findOne({
      where: { id, createdBy: userId },
    });
    if (!room) {
      throw new NotFoundException('Sala no encontrada');
    }

    room.isActive = false;
    const updatedRoom = await this.temporaryRoomRepository.save(room);
    console.log('✅ Sala desactivada:', updatedRoom.name);
    return updatedRoom;
  }

  private generateRoomCode(): string {
    return randomBytes(4).toString('hex').toUpperCase();
  }
}
