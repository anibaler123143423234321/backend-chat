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
      console.log(`❌ Usuario no encontrado en la base de datos: "${username}"`);
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

    console.log(`✅ Usuario encontrado:`, {
      username: user.username,
      nombre: user.nombre,
      apellido: user.apellido,
      displayName,
    });

    // Obtener todas las salas activas
    const allRooms = await this.temporaryRoomRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    console.log(`📊 Total de salas activas: ${allRooms.length}`);
    console.log(`🔍 Buscando salas donde "${displayName}" es miembro...`);

    // Filtrar salas donde el usuario es miembro
    const userRooms = allRooms.filter((room) => {
      const members = room.members || [];
      const isMember = members.includes(displayName);

      if (isMember) {
        console.log(`  ✅ Usuario ES miembro de sala: ${room.name} (${room.roomCode})`);
      }

      return isMember;
    });

    // 🔥 DEBUG: Mostrar las primeras 3 salas y sus miembros
    if (allRooms.length > 0) {
      console.log(`🔍 Primeras 3 salas y sus miembros:`);
      allRooms.slice(0, 3).forEach((room, index) => {
        console.log(`  Sala ${index + 1}: ${room.name} (${room.roomCode})`);
        console.log(`    Miembros:`, room.members);
      });
    }

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

        // 🔥 OPTIMIZACIÓN: Excluir arrays pesados (members, connectedMembers, assignedMembers)
        const { members, connectedMembers, assignedMembers, ...roomWithoutMembers } = room;

        return {
          ...roomWithoutMembers,
          lastMessage,
          lastActivity: lastMessage?.sentAt || room.createdAt,
        };
      }),
    );

    // 🔥 ORDENAR por lastMessage.sentAt (más reciente primero)
    const sortedEnrichedRooms = enrichedRooms.sort((a, b) => {
      const aDate = a.lastMessage?.sentAt || a.createdAt;
      const bDate = b.lastMessage?.sentAt || b.createdAt;
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    });

    return {
      rooms: sortedEnrichedRooms, // 🔥 Usar sortedEnrichedRooms
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
    page: number = 1,
    limit: number = 10,
    search?: string,
    displayName?: string,
    role?: string, // 👈 Recibir el rol
  ): Promise<any> {
    console.log('👤 Usuario:', { displayName, role });

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
      whereConditions = [
        { isActive: true, name: Like(`%${search}%`) },
        { isActive: true, roomCode: Like(`%${search}%`) },
      ];
    }

    // Obtener todas las salas que coincidan con la búsqueda
    let allRooms = await this.temporaryRoomRepository.find({
      where: whereConditions,
      order: { id: 'DESC' },
    });

    // FILTRADO POR ROL (ADMIN y JEFEPISO solo ven sus salas asignadas)
    // SUPERADMIN y PROGRAMADOR ven TODAS las salas
    if (['ADMIN', 'JEFEPISO'].includes(role)) {
      console.log(`🔒 Filtrando salas para rol ${role}`);
      const userFullName = displayName || '';
      console.log(`🔍 Filtrando por displayName: ${userFullName}`);

      allRooms = allRooms.filter(room => {
        const members = room.members || [];
        return members.includes(userFullName);
      });
    } else {
      console.log(`✅ Usuario con rol ${role || 'DESCONOCIDO'} ve TODAS las salas`);
    }

    // 🔥 QUERY OPTIMIZADA: Una sola consulta SQL con JOIN y ordenamiento
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

    // Aplicar búsqueda si existe
    if (search && search.trim()) {
      queryBuilder.andWhere(
        '(room.name LIKE :search OR room.roomCode LIKE :search)',
        { search: `%${search}%` },
      );
    }

    // FILTRADO POR ROL (Movido a lógica en memoria para evitar problemas de compatibilidad SQL)
    // if (['ADMIN', 'JEFEPISO'].includes(role)) { ... }

    // Obtener todas las salas con su último mensaje
    const { entities, raw } = await queryBuilder.getRawAndEntities();

    // Mapear resultados y agregar lastMessage desde raw
    const allRoomsWithLastMessage = entities.map((room, index) => {
      // 🔒 FILTRADO POR ROL EN MEMORIA
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
        maxCapacity: room.maxCapacity,
        currentMembers: room.currentMembers, // ✅ Solo contador
        isActive: room.isActive,
        isAssignedByAdmin: room.isAssignedByAdmin,
        settings: room.settings,
        pinnedMessageId: room.pinnedMessageId,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt,
        lastMessage,
        // ❌ NO incluir: createdBy, members, connectedMembers, assignedMembers
      };
    }).filter(room => room !== null); // Eliminar nulos del filtrado

    // Separar favoritas y no favoritas
    const favoritesWithMessage = allRoomsWithLastMessage.filter((room) =>
      favoriteRoomCodes.includes(room.roomCode),
    );
    const nonFavoritesWithMessage = allRoomsWithLastMessage.filter(
      (room) => !favoriteRoomCodes.includes(room.roomCode),
    );

    // Función de ordenamiento: CON mensajes primero, SIN mensajes después
    const sortByLastMessage = (rooms) => {
      const roomsWithMessages = rooms.filter((r) => r.lastMessage?.sentAt);
      const roomsWithoutMessages = rooms.filter((r) => !r.lastMessage?.sentAt);

      roomsWithMessages.sort((a, b) => {
        return (
          new Date(b.lastMessage.sentAt).getTime() -
          new Date(a.lastMessage.sentAt).getTime()
        );
      });

      roomsWithoutMessages.sort((a, b) => {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      return [...roomsWithMessages, ...roomsWithoutMessages];
    };

    // Ordenar cada grupo
    const sortedFavorites = sortByLastMessage(favoritesWithMessage);
    const sortedNonFavorites = sortByLastMessage(nonFavoritesWithMessage);

    // Combinar: favoritas primero, luego no-favoritas
    const finalSortedRooms = [...sortedFavorites, ...sortedNonFavorites];

    // Aplicar paginación
    const skip = (page - 1) * limit;
    const paginatedRooms = finalSortedRooms.slice(skip, skip + limit);

    console.log(
      `📋 Total: ${allRoomsWithLastMessage.length}, Favoritas: ${favoritesWithMessage.length}, Mostrando: ${paginatedRooms.length} `,
    );

    return {
      data: paginatedRooms, // 🔥 Devolver solo la página solicitada
      total: allRoomsWithLastMessage.length,
      page: page,
      limit: limit,
      totalPages: Math.ceil(allRoomsWithLastMessage.length / limit),
    };
  }

  // 🔥 NUEVO: Endpoint para obtener miembros de una sala específica
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
      maxCapacity: room.maxCapacity,
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

    // Actualizar capacidad máxima
    if (updateData.maxCapacity !== undefined) {
      if (updateData.maxCapacity < 1 || updateData.maxCapacity > 500) {
        throw new BadRequestException('La capacidad debe estar entre 1 y 500');
      }
      room.maxCapacity = updateData.maxCapacity;
    }

    // Actualizar descripción (usada para almacenar URL de imagen)
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
    // console.log('👥 Obteniendo usuarios de la sala:', roomCode);

    const room = await this.temporaryRoomRepository.findOne({
      where: { roomCode, isActive: true },
    });

    if (!room) {
      throw new NotFoundException('Sala no encontrada o inactiva');
    }

    // 🔥 MODIFICADO: Usar TODOS los usuarios añadidos a la sala (members)
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
              // 🔥 CAMPOS ENRIQUECIDOS
              role: dbUser.role,
              numeroAgente: dbUser.numeroAgente,
              picture: null, // No tenemos picture en la entidad User por ahora
              nombre: dbUser.nombre,
              apellido: dbUser.apellido,
              email: dbUser.email
            };
          } else {
            // Fallback para usuarios que no están en la BD (ej. usuarios temporales antiguos)
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
        console.error('❌ Error al enriquecer usuarios de sala:', error);
        // Fallback en caso de error de BD
        userList = allUsernames.map((username, index) => ({
          id: index + 1,
          username: username,
          displayName: username === 'Usuario' ? `Usuario ${index + 1} ` : username,
          isOnline: true, // Asumir online por defecto en error
        }));
      }
    }

    // console.log('✅ Usuarios en la sala (enriquecidos):', userList.length);

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

  // 🔥 NUEVO: Métodos para mensajes fijados
  async updatePinnedMessage(
    roomCode: string,
    pinnedMessageId: number | null,
  ): Promise<TemporaryRoom> {
    const room = await this.temporaryRoomRepository.findOne({
      where: { roomCode },
    });

    if (!room) {
      throw new NotFoundException(`Sala con código ${roomCode} no encontrada`);
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
