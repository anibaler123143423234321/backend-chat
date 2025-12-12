import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, IsNull, In } from 'typeorm';
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
  ) { }

  // Método para inyectar el gateway de WebSocket (evita dependencia circular)
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

    // 🔥 VALIDAR: Verificar si ya existe una sala activa con el mismo nombre
    const existingRoom = await this.temporaryRoomRepository.findOne({
      where: { name: createDto.name, isActive: true },
    });

    if (existingRoom) {
      throw new BadRequestException(
        `Ya existe una sala activa con el nombre "${createDto.name}". Por favor, elige otro nombre.`,
      );
    }

    const roomCode = this.generateRoomCode();

    // console.log('Código de sala generado:', roomCode);

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

    // 🔥 Notificar a todos los ADMIN y JEFEPISO que se creó una nueva sala
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

  async findUserRooms(
    username: string, // Este es el displayName que envía el frontend
    page: number = 1,
    limit: number = 10,
    search?: string, // 🔥 NUEVO: Parámetro de búsqueda
  ): Promise<{
    rooms: any[];
    total: number;
    page: number;
    totalPages: number;
    hasMore: boolean;
  }> {
    // El frontend envía el displayName (nombre completo) en el parámetro username
    const displayName = username;

    // 🔥 Obtener roomCodes de favoritos para excluirlos
    let favoriteRoomCodes: string[] = [];
    try {
      favoriteRoomCodes = await this.roomFavoritesService.getUserFavoriteRoomCodes(displayName);
      console.log(`🔥 [findUserRooms] Favoritos de ${displayName}:`, favoriteRoomCodes, '- Estos serán excluidos');
    } catch (error) {
      console.error('Error al obtener favoritos:', error);
    }

    // Obtener todas las salas activas
    const allRooms = await this.temporaryRoomRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    // Filtrar salas donde el usuario es miembro
    let userRooms = allRooms.filter((room) => {
      const members = room.members || [];
      return members.includes(displayName);
    });

    // 🔥 Excluir grupos que son favoritos - así siempre devuelve 10 NO-favoritos
    userRooms = userRooms.filter((room) => !favoriteRoomCodes.includes(room.roomCode));

    // 🔥 Aplicar filtro de búsqueda por nombre o roomCode
    if (search && search.trim()) {
      const searchLower = search.toLowerCase().trim();
      userRooms = userRooms.filter((room) =>
        room.name?.toLowerCase().includes(searchLower) ||
        room.roomCode?.toLowerCase().includes(searchLower)
      );
    }

    // Aplicar paginaci�n
    const total = userRooms.length;
    const offset = (page - 1) * limit;
    const paginatedRooms = userRooms.slice(offset, offset + limit);
    const totalPages = Math.ceil(total / limit);
    const hasMore = page < totalPages;

    // Enriquecer cada sala con informaci�n adicional (�ltimo mensaje, etc.)
    const enrichedRooms = await Promise.all(
      paginatedRooms.map(async (room) => {
        let lastMessage = null;

        try {
          // Obtener el �ltimo mensaje de la sala
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
                image: '?? Imagen',
                video: '?? Video',
                audio: '?? Audio',
                document: '?? Documento',
              };
              messageText = mediaTypeMap[msg.mediaType] || '?? Archivo';
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
            `Error al obtener �ltimo mensaje de sala ${room.roomCode}:`,
            error,
          );
        }

        // ?? OPTIMIZACI�N: Excluir arrays pesados (members, connectedMembers, assignedMembers)
        const { members, connectedMembers, assignedMembers, ...roomWithoutMembers } = room;

        return {
          ...roomWithoutMembers,
          lastActivity: room.createdAt,
        };
      }),
    );

    // ?? ORDENAR por lastMessage.sentAt (m�s reciente primero)
    // 🔥 ORDENAR por lastActivity (más reciente primero)
    const sortedEnrichedRooms = enrichedRooms.sort((a, b) => {
      const aDate = a.lastActivity || a.createdAt;
      const bDate = b.lastActivity || b.createdAt;
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    });

    return {
      rooms: sortedEnrichedRooms, // ?? Usar sortedEnrichedRooms
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
      throw new NotFoundException('Código de sala no válido');
    }

    if (!room.isActive) {
      throw new BadRequestException('La sala está inactiva');
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

    if (!room.members) {
      room.members = [];
    }
    if (!room.connectedMembers) {
      room.connectedMembers = [];
    }

    // ?? MODIFICADO: Verificar si el usuario ya estaba en la sala ANTES (en members)
    const wasAlreadyMember = room.members.includes(username);

    // console.log(`?? joinRoom - Usuario: ${username}, Sala: ${room.name}, Ya era miembro: ${wasAlreadyMember}, Capacidad: ${room.members.length}/${room.maxCapacity}`);

    // ?? IMPORTANTE: Verificar capacidad ANTES de agregar
    // Solo contar si el usuario NO era miembro antes
    if (!wasAlreadyMember && room.members.length >= room.maxCapacity) {
      console.error(
        `? Sala llena: ${room.members.length}/${room.maxCapacity} - No se puede agregar a ${username}`,
      );
      throw new BadRequestException(
        `La sala ha alcanzado su capacidad m�xima (${room.maxCapacity} usuarios)`,
      );
    }

    // Agregar al historial si no está
    if (!wasAlreadyMember) {
      room.members.push(username);
      // console.log(
      //   `? Usuario ${username} agregado a members. Total: ${room.members.length}/${room.maxCapacity}`,
      // );
    }

    // Verificar si el usuario ya estaba conectado
    const wasAlreadyConnected = room.connectedMembers.includes(username);

    // Si el usuario ya está conectado, no hacer nada
    if (wasAlreadyConnected) {
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

    // ?? MODIFICADO: currentMembers debe ser el total de usuarios A�ADIDOS (members), no solo conectados
    room.currentMembers = room.members.length;
    // console.log(`?? Guardando sala - Members: ${room.members.length}, Connected: ${room.connectedMembers.length}`);
    // console.log('👥 Usuarios conectados en la sala:', room.connectedMembers);
    // console.log('📜 Historial de usuarios:', room.members);
    await this.temporaryRoomRepository.save(room);

    // ?? MODIFICADO: Solo notificar si el usuario fue REALMENTE AGREGADO (no estaba en members antes)
    if (!wasAlreadyMember && this.socketGateway) {
      this.socketGateway.notifyUserAddedToRoom(
        username,
        room.roomCode,
        room.name,
      );
      // console.log(`?? Notificaci�n enviada para ${username}`);
    }

    // console.log(`? Usuario ${username} unido exitosamente a la sala ${room.name}`);

    // console.log('✅ Usuario unido exitosamente a la sala');
    return room;
  }

  async leaveRoom(roomCode: string, username: string): Promise<TemporaryRoom> {
    // console.log('🚪 Usuario saliendo de la sala:', username, 'de', roomCode);

    const room = await this.findByRoomCode(roomCode);

    // 🔥 NUEVO: Validar si el usuario está asignado por un admin
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
      // ?? MODIFICADO: currentMembers debe ser el total de usuarios A�ADIDOS (members), no solo conectados
      room.currentMembers = room.members.length;

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
      // ?? MODIFICADO: currentMembers debe ser el total de usuarios A�ADIDOS (members), no solo conectados
      room.currentMembers = room.members.length;
    }

    // Remover el usuario de members (historial)
    if (room.members && room.members.includes(username)) {
      room.members = room.members.filter((u) => u !== username);
    }

    // Remover el usuario de assignedMembers si está asignado
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
      console.error('❌ Error al limpiar sala actual del usuario:', error);
    }

    // Notificar a través del socket gateway
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

    const roomCode = room.roomCode; // Guardar antes de eliminar

    // console.log('✅ Sala encontrada, eliminando permanentemente:', room.name);
    await this.temporaryRoomRepository.remove(room);
    // console.log('✅ Sala eliminada permanentemente');

    // 🔥 Notificar a todos los usuarios conectados que la sala fue eliminada
    if (this.socketGateway) {
      this.socketGateway.broadcastRoomDeleted(roomCode, id);
    }
  }

  async getAdminRooms(
    page: number = 1,
    limit: number = 10,
    search?: string,
    displayName?: string,
    role?: string, // ?? Recibir el rol
  ): Promise<any> {
    // Log eliminado para optimizaci�n

    // Obtener c�digos de salas favoritas del usuario
    let favoriteRoomCodes: string[] = [];
    if (displayName) {
      try {
        favoriteRoomCodes = await this.roomFavoritesService.getUserFavoriteRoomCodes(displayName);
        // Log eliminado para optimizaci�n
      } catch (error) {
        console.error('Error al obtener favoritos:', error);
      }
    }

    // Construir condiciones de b�squeda
    let whereConditions: any = { isActive: true };

    if (search && search.trim()) {
      whereConditions = [
        { isActive: true, name: Like(`%${search}%`) },
        { isActive: true, roomCode: Like(`%${search}%`) },
      ];
    }

    // ?? NOTA: El filtrado por rol se hace en memoria despu�s del JOIN (l�neas 631-639)
    // para evitar problemas de compatibilidad SQL

    // ?? QUERY OPTIMIZADA: Una sola consulta SQL con JOIN y ordenamiento
    const queryBuilder = this.temporaryRoomRepository
      .createQueryBuilder('room')
      .leftJoin(
        (subQuery) => {
          return subQuery
            .select('m.roomCode', 'roomCode')
            .addSelect('MAX(m.id)', 'lastMessageId')
            .from('messages', 'm')
            .where('m.isDeleted = :isDeleted', { isDeleted: false })
            .andWhere('m.threadId IS NULL')
            .groupBy('m.roomCode');
        },
        'lastMsg',
        'room.roomCode = lastMsg.roomCode',
      )
      .leftJoin(
        'messages',
        'message',
        'message.id = lastMsg.lastMessageId',
      )
      .select([
        'room',
        'message.id',
        'message.message',
        'message.from',
        'message.sentAt',
        'message.time',
        'message.mediaType',
        'message.fileName',
      ])
      .where('room.isActive = :isActive', { isActive: true });

    // Aplicar b�squeda si existe
    if (search && search.trim()) {
      queryBuilder.andWhere(
        '(room.name LIKE :search OR room.roomCode LIKE :search)',
        { search: `%${search}%` },
      );
    }

    // FILTRADO POR ROL (Movido a l�gica en memoria para evitar problemas de compatibilidad SQL)
    // if (['ADMIN', 'JEFEPISO'].includes(role)) { ... }

    // Obtener todas las salas con su �ltimo mensaje
    const { entities, raw } = await queryBuilder.getRawAndEntities();

    // Mapear resultados y agregar lastMessage desde raw
    const allRoomsWithLastMessage = entities.map((room, index) => {
      // ?? FILTRADO POR ROL EN MEMORIA
      if (['ADMIN', 'JEFEPISO'].includes(role)) {
        const userFullName = displayName || '';
        const members = room.members || [];
        if (!members.includes(userFullName)) {
          return null; // Filtrar si no es miembro
        }
      }

      const rowData = raw[index];
      const lastMessage = rowData.message_id
        ? {
          id: rowData.message_id,
          text: rowData.message_message,
          from: rowData.message_from,
          sentAt: rowData.message_sentAt,
          time: rowData.message_time,
          mediaType: rowData.message_mediaType,
          fileName: rowData.message_fileName,
        }
        : null;


      // 🔥 OPTIMIZACIÓN: NO devolver arrays pesados de members/connectedMembers
      // Solo devolver contadores para reducir payload ~83%
      return {
        id: room.id,
        name: room.name,
        description: room.description,
        roomCode: room.roomCode,
        currentMembers: room.currentMembers,
        maxCapacity: room.maxCapacity,
        isActive: room.isActive,
        isAssignedByAdmin: room.isAssignedByAdmin,
        settings: room.settings,
        pinnedMessageId: room.pinnedMessageId,
        lastMessage: lastMessage ? { sentAt: lastMessage.sentAt } : null,
      };
    }).filter(room => room !== null); // Eliminar nulos del filtrado

    // Separar favoritas y no favoritas
    const favoritesWithMessage = allRoomsWithLastMessage.filter((room) =>
      favoriteRoomCodes.includes(room.roomCode),
    );
    const nonFavoritesWithMessage = allRoomsWithLastMessage.filter(
      (room) => !favoriteRoomCodes.includes(room.roomCode),
    );

    // Función de ordenamiento unificada: Por fecha más reciente del último mensaje
    const sortByLastMessage = (rooms) => {
      return rooms.sort((a, b) => {
        const timeA = new Date(a.lastMessage?.sentAt || 0).getTime();
        const timeB = new Date(b.lastMessage?.sentAt || 0).getTime();
        return timeB - timeA;
      });
    };

    // 🔥 MODIFICADO: Solo ordenar los NO-favoritos (favoritos van a su propia API)
    const sortedNonFavorites = sortByLastMessage(nonFavoritesWithMessage);

    // 🔥 MODIFICADO: Solo paginar los NO-favoritos
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;
    const paginatedRooms = sortedNonFavorites.slice(skip, skip + limitNum);

    // console.log(`🔥 [getAdminRooms] Total grupos: ${allRoomsWithLastMessage.length}, Favoritos: ${favoritesWithMessage.length}, No-favoritos: ${nonFavoritesWithMessage.length}, Devolviendo: ${paginatedRooms.length}`);

    return {
      data: paginatedRooms, // 🔥 Solo NO-favoritos
      total: nonFavoritesWithMessage.length, // 🔥 Total de NO-favoritos
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(nonFavoritesWithMessage.length / limit),
    };
  }

  // ?? NUEVO: Endpoint para obtener miembros de una sala espec�fica
  async getRoomMembers(roomCode: string): Promise<any> {
    const room = await this.temporaryRoomRepository.findOne({
      where: { roomCode, isActive: true },
    });

    if (!room) {
      throw new NotFoundException('Sala no encontrada');
    }

    return {
      roomCode: room.roomCode,
      members: room.members || [],
      connectedMembers: room.connectedMembers || [],
      assignedMembers: room.assignedMembers || [],
      currentMembers: room.currentMembers,
    };
  }

  async deactivateRoom(id: number, userId: number): Promise<TemporaryRoom> {
    // console.log('⏸️ Desactivando sala:', id, 'por usuario:', userId);
    const room = await this.temporaryRoomRepository.findOne({
      where: { id, createdBy: userId },
    });
    if (!room) {
      throw new NotFoundException('Sala no encontrada');
    }

    const roomCode = room.roomCode; // Guardar antes de desactivar

    room.isActive = false;
    const updatedRoom = await this.temporaryRoomRepository.save(room);
    // console.log('✅ Sala desactivada:', updatedRoom.name);

    // 🔥 Notificar a todos los usuarios conectados que la sala fue desactivada
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
    updateData: { maxCapacity?: number; picture?: string; description?: string },
  ): Promise<TemporaryRoom> {
    const room = await this.temporaryRoomRepository.findOne({
      where: { id, createdBy: userId },
    });

    if (!room) {
      throw new NotFoundException(
        'Sala no encontrada o no tienes permisos para editarla',
      );
    }

    // Actualizar capacidad m�xima
    if (updateData.maxCapacity !== undefined) {
      if (updateData.maxCapacity < 1 || updateData.maxCapacity > 500) {
        throw new BadRequestException('La capacidad debe estar entre 1 y 500');
      }
      room.maxCapacity = updateData.maxCapacity;
    }

    // Actualizar descripci�n (usada para almacenar URL de imagen)
    if (updateData.description !== undefined) {
      room.description = updateData.description;
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
          ? `${user.nombre} ${user.apellido} `
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
      console.error('❌ Error de conexión a la base de datos:', error);
      // En caso de error de BD, devolver que no está en ninguna sala
      // para que la aplicación pueda continuar funcionando
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
      console.error('❌ Error al buscar sala del usuario:', error);
      return { inRoom: false, room: null };
    }
  }

  async getRoomUsers(roomCode: string): Promise<any> {
    // console.log('?? Obteniendo usuarios de la sala:', roomCode);

    const room = await this.temporaryRoomRepository.findOne({
      where: { roomCode, isActive: true },
    });

    if (!room) {
      throw new NotFoundException('Sala no encontrada o inactiva');
    }

    // ?? MODIFICADO: Usar TODOS los usuarios a�adidos a la sala (members)
    const allUsernames = room.members || [];
    let userList = [];

    if (allUsernames.length > 0) {
      try {
        // 1. Obtener datos completos de la base de datos
        const dbUsers = await this.userRepository.find({
          where: { username: In(allUsernames) },
        });

        // 2. Mapear usuarios combinando datos de BD y estado online
        userList = allUsernames.map((username, index) => {
          // Buscar datos en la respuesta de BD
          const dbUser = dbUsers.find((u) => u.username === username);

          // Verificar estado online en tiempo real
          const isOnline = this.socketGateway
            ? this.socketGateway.isUserOnline(username)
            : false;

          if (dbUser) {
            return {
              id: dbUser.id,
              username: dbUser.username,
              displayName: dbUser.nombre && dbUser.apellido
                ? `${dbUser.nombre} ${dbUser.apellido} `
                : dbUser.username,
              isOnline: isOnline,
              // ?? CAMPOS ENRIQUECIDOS
              role: dbUser.role,
              numeroAgente: dbUser.numeroAgente,
              picture: null, // No tenemos picture en la entidad User por ahora
              nombre: dbUser.nombre,
              apellido: dbUser.apellido,
              email: dbUser.email
            };
          } else {
            // Fallback para usuarios que no est�n en la BD (ej. usuarios temporales antiguos)
            return {
              id: index + 1, // ID temporal
              username: username,
              displayName: username === 'Usuario' ? `Usuario ${index + 1} ` : username,
              isOnline: isOnline,
              role: 'GUEST',
              numeroAgente: null
            };
          }
        });
      } catch (error) {
        console.error('? Error al enriquecer usuarios de sala:', error);
        // Fallback en caso de error de BD
        userList = allUsernames.map((username, index) => ({
          id: index + 1,
          username: username,
          displayName: username === 'Usuario' ? `Usuario ${index + 1} ` : username,
          isOnline: true, // Asumir online por defecto en error
        }));
      }
    }

    // console.log('? Usuarios en la sala (enriquecidos):', userList.length);

    return {
      roomCode: room.roomCode,
      roomName: room.name,
      users: userList,
      totalUsers: userList.length,
      maxCapacity: room.maxCapacity,
    };
  }

  // ?? NUEVO: Buscar sala por nombre (para grupos)
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

  /**
   * 🚀 OPTIMIZACIÓN: Buscar salas donde el usuario es miembro
   * Usa query SQL directa en lugar de cargar todas las salas y filtrar en memoria
   */
  async findByMember(username: string): Promise<TemporaryRoom[]> {
    try {
      // Usar LIKE con JSON para buscar en el array members
      // Esto es más eficiente que cargar todas las salas y filtrar
      const rooms = await this.temporaryRoomRepository
        .createQueryBuilder('room')
        .where('room.isActive = :isActive', { isActive: true })
        .andWhere(
          '(room.members LIKE :memberPattern OR room.connectedMembers LIKE :memberPattern)',
          { memberPattern: `%"${username}"%` }
        )
        .getMany();

      return rooms;
    } catch (error) {
      console.error(`❌ Error al buscar salas del usuario ${username}:`, error);
      return [];
    }
  }

  // ?? NUEVO: Actualizar miembros de sala (para sincronizar cambios de grupos)
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

  // ?? NUEVO: M�todos para mensajes fijados
  async updatePinnedMessage(
    roomCode: string,
    pinnedMessageId: number | null,
  ): Promise<TemporaryRoom> {
    const room = await this.temporaryRoomRepository.findOne({
      where: { roomCode },
    });

    if (!room) {
      throw new NotFoundException(`Sala con c�digo ${roomCode} no encontrada`);
    }

    room.pinnedMessageId = pinnedMessageId;
    return await this.temporaryRoomRepository.save(room);
  }

  async getPinnedMessage(roomCode: string): Promise<number | null> {
    const room = await this.temporaryRoomRepository.findOne({
      where: { roomCode },
      select: ['pinnedMessageId'],
    });

    return room?.pinnedMessageId || null;
  }
}
