import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, IsNull } from 'typeorm';
import { TemporaryRoom } from './entities/temporary-room.entity';
import { CreateTemporaryRoomDto } from './dto/create-temporary-room.dto';
import { JoinRoomDto } from './dto/join-room.dto';
import { User } from '../users/entities/user.entity';
import { Message } from '../messages/entities/message.entity';
import { randomBytes } from 'crypto';
import { RoomFavoritesService } from '../room-favorites/room-favorites.service';

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
  private socketGateway: any; // Referencia al gateway de WebSocket

  constructor(
    @InjectRepository(TemporaryRoom)
    private temporaryRoomRepository: Repository<TemporaryRoom>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    private roomFavoritesService: RoomFavoritesService,
  ) {}

  // MÃ©todo para inyectar el gateway de WebSocket (evita dependencia circular)
  setSocketGateway(gateway: any) {
    this.socketGateway = gateway;
  }

  async create(
    createDto: CreateTemporaryRoomDto,
    userId: number,
    creatorUsername?: string,
  ): Promise<TemporaryRoomWithUrl> {
    // console.log('Creando sala temporal con datos:', createDto);
    // console.log('Usuario ID:', userId);
    // console.log('Nombre del creador:', creatorUsername);

    // ðŸ”¥ VALIDAR: Verificar si ya existe una sala activa con el mismo nombre
    const existingRoom = await this.temporaryRoomRepository.findOne({
      where: { name: createDto.name, isActive: true },
    });

    if (existingRoom) {
      throw new BadRequestException(
        `Ya existe una sala activa con el nombre "${createDto.name}". Por favor, elige otro nombre.`,
      );
    }

    const roomCode = this.generateRoomCode();

    // console.log('CÃ³digo de sala generado:', roomCode);

    // Inicializar con el creador como primer miembro
    const members = creatorUsername ? [creatorUsername] : []; // Historial
    const connectedMembers = creatorUsername ? [creatorUsername] : []; // Conectados actualmente
    const currentMembers = creatorUsername ? 1 : 0;

    const room = this.temporaryRoomRepository.create({
      ...createDto,
      roomCode,
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

    // ðŸ”¥ Notificar a todos los ADMIN y JEFEPISO que se creÃ³ una nueva sala
    if (this.socketGateway) {
      this.socketGateway.broadcastRoomCreated(savedRoom);
    }

    // console.log('Resultado final a devolver:', result);
    return result;
  }

  async findAll(): Promise<TemporaryRoom[]> {
    return await this.temporaryRoomRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  // 🔥 NUEVO: Método con paginación para salas del usuario
  async findUserRooms(
    username: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{
    rooms: any[];
    total: number;
    page: number;
    totalPages: number;
    hasMore: boolean;
  }> {
    console.log(
      `🔍 findUserRooms - Usuario: "${username}", Página: ${page}, Límite: ${limit}`,
    );

    // Buscar el usuario para obtener su displayName
    const user = await this.userRepository.findOne({ where: { username } });
    if (!user) {
      return {
        rooms: [],
        total: 0,
        page,
        totalPages: 0,
        hasMore: false,
      };
    }

    // Construir el displayName (nombre completo) igual que en el frontend
    const displayName =
      user.nombre && user.apellido
        ? `${user.nombre} ${user.apellido}`
        : user.username;

    // Obtener todas las salas activas
    const allRooms = await this.temporaryRoomRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    // Filtrar salas donde el usuario es miembro
    const userRooms = allRooms.filter((room) => {
      const members = room.members || [];
      return members.includes(displayName);
    });

    // Aplicar paginación
    const total = userRooms.length;
    const offset = (page - 1) * limit;
    const paginatedRooms = userRooms.slice(offset, offset + limit);
    const totalPages = Math.ceil(total / limit);
    const hasMore = page < totalPages;

    console.log(
      `  Total salas del usuario: ${total}, Página actual: ${page}/${totalPages}, Mostrando: ${paginatedRooms.length}`,
    );

    // Enriquecer cada sala con información adicional (último mensaje, etc.)
    const enrichedRooms = await Promise.all(
      paginatedRooms.map(async (room) => {
        let lastMessage = null;

        try {
          // Obtener el último mensaje de la sala
          const messages = await this.messageRepository.find({
            where: { roomCode: room.roomCode, isDeleted: false },
            order: { sentAt: 'DESC' },
            take: 1,
          });

          if (messages.length > 0) {
            const msg = messages[0];

            // Si es un archivo multimedia sin texto, mostrar el tipo de archivo
            let messageText = msg.message;
            if (!messageText && msg.mediaType) {
              const mediaTypeMap = {
                image: '📷 Imagen',
                video: '🎥 Video',
                audio: '🎵 Audio',
                document: '📄 Documento',
              };
              messageText = mediaTypeMap[msg.mediaType] || '📎 Archivo';
            }

            lastMessage = {
              text: messageText || msg.fileName || 'Archivo',
              from: msg.from,
              sentAt: msg.sentAt,
              mediaType: msg.mediaType,
              fileName: msg.fileName,
            };
          }
        } catch (error) {
          console.error(
            `Error al obtener último mensaje de sala ${room.roomCode}:`,
            error,
          );
        }

        return {
          ...room,
          lastMessage,
          lastActivity: lastMessage?.sentAt || room.createdAt,
        };
      }),
    );

    return {
      rooms: enrichedRooms,
      total,
      page,
      totalPages,
      hasMore,
    };
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
      throw new NotFoundException('CÃ³digo de sala no vÃ¡lido');
    }

    if (!room.isActive) {
      throw new BadRequestException('La sala estÃ¡ inactiva');
    }

    return room;
  }

  async joinRoom(
    joinDto: JoinRoomDto,
    username: string,
  ): Promise<TemporaryRoom> {
    // console.log('ðŸ” Buscando sala con cÃ³digo:', joinDto.roomCode);
    // console.log('ðŸ‘¤ Usuario que se une:', username);

    const room = await this.findByRoomCode(joinDto.roomCode);
    // console.log('ðŸ  Sala encontrada:', room);

    if (!room.members) {
      room.members = [];
    }
    if (!room.connectedMembers) {
      room.connectedMembers = [];
    }

    // 🔥 MODIFICADO: Verificar si el usuario ya estaba en la sala ANTES (en members)
    const wasAlreadyMember = room.members.includes(username);

    // console.log(`🔄 joinRoom - Usuario: ${username}, Sala: ${room.name}, Ya era miembro: ${wasAlreadyMember}, Capacidad: ${room.members.length}/${room.maxCapacity}`);

    // 🔥 IMPORTANTE: Verificar capacidad ANTES de agregar
    // Solo contar si el usuario NO era miembro antes
    if (!wasAlreadyMember && room.members.length >= room.maxCapacity) {
      console.error(
        `❌ Sala llena: ${room.members.length}/${room.maxCapacity} - No se puede agregar a ${username}`,
      );
      throw new BadRequestException(
        `La sala ha alcanzado su capacidad máxima (${room.maxCapacity} usuarios)`,
      );
    }

    // Agregar al historial si no estÃ¡
    if (!wasAlreadyMember) {
      room.members.push(username);
      console.log(
        `➕ Usuario ${username} agregado a members. Total: ${room.members.length}/${room.maxCapacity}`,
      );
    }

    // Verificar si el usuario ya estaba conectado
    const wasAlreadyConnected = room.connectedMembers.includes(username);

    // Si el usuario ya estÃ¡ conectado, no hacer nada
    if (wasAlreadyConnected) {
      // console.log('ðŸ‘¤ Usuario ya estÃ¡ conectado en la sala');
      return room;
    }

    // Si hay un "Usuario" genÃ©rico en connectedMembers, reemplazarlo
    const genericUserIndex = room.connectedMembers.indexOf('Usuario');
    if (genericUserIndex !== -1) {
      room.connectedMembers[genericUserIndex] = username;
      // console.log('ðŸ”„ Reemplazando "Usuario" genÃ©rico con:', username);
    } else {
      // Agregar a usuarios conectados
      room.connectedMembers.push(username);
    }

    // 🔥 MODIFICADO: currentMembers debe ser el total de usuarios AÑADIDOS (members), no solo conectados
    room.currentMembers = room.members.length;
    // console.log(`💾 Guardando sala - Members: ${room.members.length}, Connected: ${room.connectedMembers.length}`);
    // console.log('ðŸ‘¥ Usuarios conectados en la sala:', room.connectedMembers);
    // console.log('ðŸ“œ Historial de usuarios:', room.members);
    await this.temporaryRoomRepository.save(room);

    // 🔥 MODIFICADO: Solo notificar si el usuario fue REALMENTE AGREGADO (no estaba en members antes)
    if (!wasAlreadyMember && this.socketGateway) {
      this.socketGateway.notifyUserAddedToRoom(
        username,
        room.roomCode,
        room.name,
      );
      console.log(`📢 Notificación enviada para ${username}`);
    }

    // console.log(`✅ Usuario ${username} unido exitosamente a la sala ${room.name}`);

    // console.log('âœ… Usuario unido exitosamente a la sala');
    return room;
  }

  async leaveRoom(roomCode: string, username: string): Promise<TemporaryRoom> {
    // console.log('ðŸšª Usuario saliendo de la sala:', username, 'de', roomCode);

    const room = await this.findByRoomCode(roomCode);

    // ðŸ”¥ NUEVO: Validar si el usuario estÃ¡ asignado por un admin
    if (
      room.isAssignedByAdmin &&
      room.assignedMembers &&
      room.assignedMembers.includes(username)
    ) {
      throw new BadRequestException(
        'No puedes salir de esta sala porque fuiste asignado por un administrador',
      );
    }

    if (!room.connectedMembers) {
      room.connectedMembers = [];
    }

    // Remover el usuario solo de connectedMembers (mantener en historial)
    const userIndex = room.connectedMembers.indexOf(username);
    if (userIndex !== -1) {
      room.connectedMembers.splice(userIndex, 1);
      // 🔥 MODIFICADO: currentMembers debe ser el total de usuarios AÑADIDOS (members), no solo conectados
      room.currentMembers = room.members.length;

      // console.log('ðŸ‘¥ Usuarios conectados despuÃ©s de salir:', room.connectedMembers);
      // console.log('ðŸ“œ Historial de usuarios (sin cambios):', room.members);
      await this.temporaryRoomRepository.save(room);
      // console.log('âœ… Usuario desconectado de la sala en BD');
    } else {
      // console.log('âŒ Usuario no encontrado en connectedMembers');
    }

    // Limpiar la sala actual del usuario en la base de datos
    try {
      const user = await this.userRepository.findOne({ where: { username } });
      if (user && user.currentRoomCode === roomCode) {
        user.currentRoomCode = null;
        await this.userRepository.save(user);
        // console.log('âœ… Sala actual del usuario limpiada en BD');
      }
    } catch (error) {
      // console.error('âŒ Error al limpiar sala actual del usuario:', error);
    }

    return room;
  }

  async removeUserFromRoom(roomCode: string, username: string): Promise<any> {
    const room = await this.findByRoomCode(roomCode);

    if (!room) {
      throw new NotFoundException('Sala no encontrada');
    }

    // Remover el usuario de connectedMembers
    if (room.connectedMembers && room.connectedMembers.includes(username)) {
      room.connectedMembers = room.connectedMembers.filter(
        (u) => u !== username,
      );
      // 🔥 MODIFICADO: currentMembers debe ser el total de usuarios AÑADIDOS (members), no solo conectados
      room.currentMembers = room.members.length;
    }

    // Remover el usuario de members (historial)
    if (room.members && room.members.includes(username)) {
      room.members = room.members.filter((u) => u !== username);
    }

    // Remover el usuario de assignedMembers si estÃ¡ asignado
    if (room.assignedMembers && room.assignedMembers.includes(username)) {
      room.assignedMembers = room.assignedMembers.filter((u) => u !== username);
    }

    await this.temporaryRoomRepository.save(room);

    // Limpiar la sala actual del usuario en la base de datos
    try {
      const user = await this.userRepository.findOne({ where: { username } });
      if (user && user.currentRoomCode === roomCode) {
        user.currentRoomCode = null;
        await this.userRepository.save(user);
      }
    } catch (error) {
      console.error('âŒ Error al limpiar sala actual del usuario:', error);
    }

    // Notificar a travÃ©s del socket gateway
    if (this.socketGateway) {
      this.socketGateway.handleUserRemovedFromRoom(roomCode, username);
    }

    return {
      message: `Usuario ${username} eliminado de la sala ${room.name}`,
      roomCode: room.roomCode,
      username: username,
    };
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
    //   'ðŸ—‘ï¸ Eliminando permanentemente sala:',
    //   id,
    //   'por usuario:',
    //   userId,
    // );
    const room = await this.temporaryRoomRepository.findOne({
      where: { id, createdBy: userId },
    });
    if (!room) {
      // console.log('âŒ Sala no encontrada o no pertenece al usuario');
      throw new NotFoundException(
        'Sala no encontrada o no tienes permisos para eliminarla',
      );
    }

    const roomCode = room.roomCode; // Guardar antes de eliminar

    // console.log('âœ… Sala encontrada, eliminando permanentemente:', room.name);
    await this.temporaryRoomRepository.remove(room);
    // console.log('âœ… Sala eliminada permanentemente');

    // ðŸ”¥ Notificar a todos los usuarios conectados que la sala fue eliminada
    if (this.socketGateway) {
      this.socketGateway.broadcastRoomDeleted(roomCode, id);
    }
  }

  async getAdminRooms(
    userId: number,
    page: number = 1,
    limit: number = 10,
    search?: string,
    username?: string,
  ): Promise<any> {
    // 🔥 MODIFICADO: Retornar salas con paginación y búsqueda
    // console.log('ðŸ” Obteniendo salas del admin:', userId, 'page:', page, 'limit:', limit, 'search:', search);

    // Usar el displayName del query parameter si está disponible
    const displayName = username;
    
    console.log('👤 Usuario para favoritos:', { userId, displayName });

    // Obtener códigos de salas favoritas del usuario
    let favoriteRoomCodes: string[] = [];
    if (displayName) {
      try {
        favoriteRoomCodes = await this.roomFavoritesService.getUserFavoriteRoomCodes(displayName);
        console.log('⭐ Salas favoritas del usuario:', favoriteRoomCodes);
      } catch (error) {
        console.error('Error al obtener favoritos:', error);
      }
    }

    // Construir condiciones de búsqueda
    let whereConditions: any = { isActive: true };

    if (search && search.trim()) {
      // Buscar por nombre O código de sala
      whereConditions = [
        { isActive: true, name: Like(`%${search}%`) },
        { isActive: true, roomCode: Like(`%${search}%`) },
      ];
    }

    // 🔥 NUEVA LÓGICA: Obtener todas las salas que coincidan con la búsqueda
    const allRooms = await this.temporaryRoomRepository.find({
      where: whereConditions,
      order: { createdAt: 'DESC' },
    });

    // Separar salas favoritas y no favoritas
    const favoriteRooms = allRooms.filter(room => favoriteRoomCodes.includes(room.roomCode));
    const nonFavoriteRooms = allRooms.filter(room => !favoriteRoomCodes.includes(room.roomCode));

    // Combinar: favoritas primero, luego no favoritas
    const sortedRooms = [...favoriteRooms, ...nonFavoriteRooms];

    // Aplicar paginación a la lista ordenada
    const skip = (page - 1) * limit;
    const paginatedRooms = sortedRooms.slice(skip, skip + limit);

    console.log(`📋 Total salas: ${allRooms.length}, Favoritas: ${favoriteRooms.length}, Mostrando: ${paginatedRooms.length}`);

    // console.log('ðŸ“‹ Salas encontradas:', rooms.length, 'Total:', total);

    // 🔥 NUEVO: Agregar el último mensaje de cada sala
    const roomsWithLastMessage = await Promise.all(
      paginatedRooms.map(async (room) => {
        // Obtener el último mensaje de la sala
        const lastMessage = await this.messageRepository.findOne({
          where: {
            roomCode: room.roomCode,
            isDeleted: false,
            threadId: IsNull(),
          },
          order: { id: 'DESC' },
        });

        return {
          ...room,
          lastMessage: lastMessage
            ? {
                id: lastMessage.id,
                text: lastMessage.message,
                from: lastMessage.from,
                sentAt: lastMessage.sentAt,
                time: lastMessage.time,
                mediaType: lastMessage.mediaType,
                fileName: lastMessage.fileName,
              }
            : null,
        };
      }),
    );

    return {
      data: roomsWithLastMessage,
      total: allRooms.length,
      page: page,
      limit: limit,
      totalPages: Math.ceil(allRooms.length / limit),
    };
  }

  async deactivateRoom(id: number, userId: number): Promise<TemporaryRoom> {
    // console.log('â¸ï¸ Desactivando sala:', id, 'por usuario:', userId);
    const room = await this.temporaryRoomRepository.findOne({
      where: { id, createdBy: userId },
    });
    if (!room) {
      throw new NotFoundException('Sala no encontrada');
    }

    const roomCode = room.roomCode; // Guardar antes de desactivar

    room.isActive = false;
    const updatedRoom = await this.temporaryRoomRepository.save(room);
    // console.log('âœ… Sala desactivada:', updatedRoom.name);

    // ðŸ”¥ Notificar a todos los usuarios conectados que la sala fue desactivada
    if (this.socketGateway) {
      this.socketGateway.broadcastRoomDeleted(roomCode, id);
    }

    return updatedRoom;
  }

  async activateRoom(id: number, userId: number): Promise<TemporaryRoom> {
    const room = await this.temporaryRoomRepository.findOne({
      where: { id, createdBy: userId },
    });
    if (!room) {
      throw new NotFoundException('Sala no encontrada');
    }

    room.isActive = true;
    const updatedRoom = await this.temporaryRoomRepository.save(room);

    return updatedRoom;
  }

  async updateRoom(
    id: number,
    userId: number,
    updateData: { maxCapacity?: number },
  ): Promise<TemporaryRoom> {
    const room = await this.temporaryRoomRepository.findOne({
      where: { id, createdBy: userId },
    });

    if (!room) {
      throw new NotFoundException(
        'Sala no encontrada o no tienes permisos para editarla',
      );
    }

    // Actualizar capacidad mÃ¡xima
    if (updateData.maxCapacity !== undefined) {
      if (updateData.maxCapacity < 1 || updateData.maxCapacity > 500) {
        throw new BadRequestException('La capacidad debe estar entre 1 y 500');
      }
      room.maxCapacity = updateData.maxCapacity;
    }

    const updatedRoom = await this.temporaryRoomRepository.save(room);

    return updatedRoom;
  }

  async getCurrentUserRoom(userId: number): Promise<any> {
    try {
      // Primero obtener el usuario completo
      const user = await this.userRepository.findOne({ where: { id: userId } });

      if (!user) {
        return { inRoom: false, room: null };
      }

      // Construir el displayName (nombre completo) igual que en el frontend
      const displayName =
        user.nombre && user.apellido
          ? `${user.nombre} ${user.apellido}`
          : user.username;

      // Buscar todas las salas activas
      const allRooms = await this.temporaryRoomRepository.find({
        where: { isActive: true },
      });

      // Filtrar salas donde el usuario es miembro (buscar por displayName)
      const userRooms = allRooms.filter((room) => {
        const members = room.members || [];
        const isMember = members.includes(displayName);
        if (isMember) {
        }
        return isMember;
      });

      if (userRooms.length === 0) {
        return { inRoom: false, room: null };
      }

      // Devolver la primera sala activa
      const currentRoom = userRooms[0];

      return {
        inRoom: true,
        room: {
          id: currentRoom.id,
          name: currentRoom.name,
          roomCode: currentRoom.roomCode,
          maxCapacity: currentRoom.maxCapacity,
          currentMembers: currentRoom.currentMembers,
          isActive: currentRoom.isActive,
        },
      };
    } catch (error) {
      console.error('âŒ Error de conexiÃ³n a la base de datos:', error);
      // En caso de error de BD, devolver que no estÃ¡ en ninguna sala
      // para que la aplicaciÃ³n pueda continuar funcionando
      return {
        inRoom: false,
        room: null,
        error: 'Database connection error',
      };
    }
  }

  async getCurrentUserRoomByUsername(username: string): Promise<any> {
    try {
      // Buscar todas las salas activas
      const allRooms = await this.temporaryRoomRepository.find({
        where: { isActive: true },
      });

      // Filtrar salas donde el usuario es miembro
      const userRooms = allRooms.filter((room) => {
        const members = room.members || [];
        const isMember = members.includes(username);
        if (isMember) {
        }
        return isMember;
      });

      if (userRooms.length === 0) {
        return { inRoom: false, room: null };
      }

      // Devolver la primera sala activa
      const currentRoom = userRooms[0];

      return {
        inRoom: true,
        room: {
          id: currentRoom.id,
          name: currentRoom.name,
          roomCode: currentRoom.roomCode,
          maxCapacity: currentRoom.maxCapacity,
          currentMembers: currentRoom.currentMembers,
          isActive: currentRoom.isActive,
        },
      };
    } catch (error) {
      console.error('âŒ Error al buscar sala del usuario:', error);
      return { inRoom: false, room: null };
    }
  }

  async getRoomUsers(roomCode: string): Promise<any> {
    // console.log('ðŸ‘¥ Obteniendo usuarios de la sala:', roomCode);

    const room = await this.temporaryRoomRepository.findOne({
      where: { roomCode, isActive: true },
    });

    if (!room) {
      throw new NotFoundException('Sala no encontrada o inactiva');
    }

    // 🔥 MODIFICADO: Usar TODOS los usuarios añadidos a la sala (members)
    const allUsers = room.members || [];

    // Crear lista con TODOS los usuarios añadidos a la sala
    let userList = [];
    if (allUsers.length > 0) {
      userList = allUsers.map((username, index) => ({
        id: index + 1,
        username: username,
        displayName: username === 'Usuario' ? `Usuario ${index + 1}` : username,
        isOnline: true,
      }));
    }

    // console.log('✅ Usuarios en la sala (añadidos):', userList);

    return {
      roomCode: room.roomCode,
      roomName: room.name,
      users: userList,
      totalUsers: userList.length,
      maxCapacity: room.maxCapacity,
    };
  }

  // 🔥 NUEVO: Buscar sala por nombre (para grupos)
  async findByName(name: string): Promise<TemporaryRoom | null> {
    try {
      const room = await this.temporaryRoomRepository.findOne({
        where: { name, isActive: true },
      });
      return room || null;
    } catch (error) {
      console.error('Error al buscar sala por nombre:', error);
      return null;
    }
  }

  // 🔥 NUEVO: Actualizar miembros de sala (para sincronizar cambios de grupos)
  async updateRoomMembers(
    id: number,
    updateData: Partial<TemporaryRoom>,
  ): Promise<TemporaryRoom> {
    try {
      const room = await this.temporaryRoomRepository.findOne({
        where: { id },
      });

      if (!room) {
        throw new NotFoundException('Sala no encontrada');
      }

      // Actualizar solo los campos de miembros
      if (updateData.members !== undefined) {
        room.members = updateData.members;
      }
      if (updateData.connectedMembers !== undefined) {
        room.connectedMembers = updateData.connectedMembers;
      }
      if (updateData.currentMembers !== undefined) {
        room.currentMembers = updateData.currentMembers;
      }

      return await this.temporaryRoomRepository.save(room);
    } catch (error) {
      console.error('Error al actualizar miembros de sala:', error);
      throw error;
    }
  }

  private generateRoomCode(): string {
    return randomBytes(4).toString('hex').toUpperCase();
  }
}
