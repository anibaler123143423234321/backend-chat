import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
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
import { MessagesService } from '../messages/messages.service';

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
    @Inject(forwardRef(() => MessagesService))
    private messagesService: MessagesService,
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

  // 🔥 NUEVO: Listar TODAS las salas paginadas (para el modal de gestión)
  async findAllPaginated(
    page: number = 1,
    limit: number = 10,
    search?: string,
  ): Promise<{ data: any[]; total: number; page: number; totalPages: number }> {
    const queryBuilder = this.temporaryRoomRepository
      .createQueryBuilder('room')
      .where('room.isActive = :isActive', { isActive: true });

    if (search && search.trim()) {
      queryBuilder.andWhere(
        '(room.name LIKE :search OR room.roomCode LIKE :search)',
        { search: `%${search.trim()}%` },
      );
    }

    queryBuilder.orderBy('room.createdAt', 'DESC');

    const total = await queryBuilder.getCount();
    const totalPages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;

    const rooms = await queryBuilder.skip(skip).take(limit).getMany();

    const data = rooms.map(room => ({
      id: room.id,
      name: room.name,
      description: room.description,
      roomCode: room.roomCode,
      currentMembers: room.currentMembers,
      members: room.members || [], // 🔥 AGREGADO: Para que el modal pueda mostrar quiénes están unidos
      maxCapacity: room.maxCapacity,
      isActive: room.isActive,
      createdAt: room.createdAt,
    }));

    return { data, total, page, totalPages };
  }

  async findUserRooms(
    username: string,
    page: number = 1,
    limit: number = 10,
    search?: string,
  ): Promise<{
    rooms: any[];
    total: number;
    page: number;
    totalPages: number;
    hasMore: boolean;
  }> {
    const displayName = username;

    // 1. Construir QueryBuilder base
    const queryBuilder = this.temporaryRoomRepository
      .createQueryBuilder('room')
      .select([
        'room.id',
        'room.name',
        'room.description',
        'room.roomCode',
        'room.maxCapacity',
        'room.currentMembers',
        'room.isActive',
        'room.isAssignedByAdmin',
        'room.createdAt',
        'room.updatedAt',
      ])
      .where('room.isActive = :isActive', { isActive: true })
      // 🔥 MODIFICADO: Usar LIKE para mayor flexibilidad con case-sensitivity y displayNames
      .andWhere('(room.members LIKE :search OR room.connectedMembers LIKE :search OR room.assignedMembers LIKE :search)', { search: `%${username}%` });

    // 2. Excluir favoritos directamente en SQL para optimización
    queryBuilder.andWhere((qb) => {
      const subQuery = qb
        .subQuery()
        .select('rf.roomCode')
        .from('room_favorites', 'rf')
        .where('rf.username = :favUsername')
        .getQuery();
      return 'room.roomCode NOT IN ' + subQuery;
    });

    queryBuilder.setParameters({
      username: JSON.stringify(username),
      favUsername: username,
    });

    // 4. Aplicar búsqueda
    if (search && search.trim()) {
      queryBuilder.andWhere(
        '(room.name LIKE :search OR room.roomCode LIKE :search)',
        { search: `%${search}%` },
      );
    }

    // 5. Ordenar por fecha de creación
    queryBuilder.orderBy('room.createdAt', 'DESC');

    // 6. Obtener total y aplicar paginación
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skipNum = (pageNum - 1) * limitNum;

    // Obtener el conteo total
    const total = await queryBuilder.getCount();

    // Aplicar paginación al queryBuilder
    queryBuilder.skip(skipNum).take(limitNum);

    const entities = await queryBuilder.getMany();

    const paginatedRooms = entities.map((room) => {
      // Excluir arrays pesados para el listado (aunque ya el select los excluye)
      const { members, connectedMembers, assignedMembers, pendingMembers, ...roomData } = room;

      return {
        ...roomData,
        lastActivity: room.updatedAt || room.createdAt,
      };
    });

    const totalPages = Math.ceil(total / limitNum);
    const hasMore = pageNum < totalPages;

    return {
      rooms: paginatedRooms,
      total,
      page: pageNum,
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
    const room = await this.findByRoomCode(joinDto.roomCode);

    if (!room.members) room.members = [];
    if (!room.connectedMembers) room.connectedMembers = [];
    if (!room.pendingMembers) room.pendingMembers = [];

    const wasAlreadyMember = room.members.includes(username);
    const isPending = room.pendingMembers.includes(username);

    // Si ya está pendiente, notificar al usuario
    if (isPending) {
      throw new BadRequestException('Tu solicitud para unirte a esta sala está pendiente de aprobación.');
    }

    // Si NO es miembro y NO está pendiente, agregarlo a pendientes (NO a members)
    // EXCEPCIÓN: Si el usuario es el CREADOR, entra directo
    // EXCEPCIÓN: Si la sala es pública o no requiere aprobación (podríamos agregar un flag isPublic)
    // POR AHORA: Aplicamos lógica de aprobación para evitar "ghost users"

    // Verificar si es el creador (si tenemos userId en algún lado, pero aquí solo llega username)
    // Asumiremos que si no es miembro, va a pendiente.
    if (!wasAlreadyMember) {
      // Verificar capacidad (considerando miembros + pendientes?)
      if (room.members.length >= room.maxCapacity) {
        throw new BadRequestException(`La sala ha alcanzado su capacidad máxima (${room.maxCapacity} usuarios)`);
      }

      // AGREGAR A PENDIENTES
      room.pendingMembers.push(username);
      await this.temporaryRoomRepository.save(room);

      // Notificar a Admins (si hubiera lógica en gateway)
      if (this.socketGateway && this.socketGateway.notifyAdminJoinRequest) {
        this.socketGateway.notifyAdminJoinRequest(room.roomCode, username);
      }

      throw new BadRequestException('Solicitud enviada. Esperando aprobación de un administrador.');
    }

    // --- FLUJO NORMAL PARA MIEMBROS YA APROBADOS ---

    // Verificar si el usuario ya estaba conectado
    const wasAlreadyConnected = room.connectedMembers.includes(username);

    if (wasAlreadyConnected) {
      return room;
    }

    // Si hay un "Usuario" genérico en connectedMembers, reemplazarlo
    const genericUserIndex = room.connectedMembers.indexOf('Usuario');
    if (genericUserIndex !== -1) {
      room.connectedMembers[genericUserIndex] = username;
    } else {
      room.connectedMembers.push(username);
    }

    room.currentMembers = room.members.length;
    await this.temporaryRoomRepository.save(room);

    // Solo notificar si realmente se conectó (aunque ya era miembro)
    // En este caso, notifyUserAddedToRoom suena a "Nuevo usuario", tal vez deberíamos tener "UserConnected"
    // Pero mantenemos la lógica existente para evitar romper el frontend
    if (this.socketGateway) {
      this.socketGateway.notifyUserAddedToRoom(
        username,
        room.roomCode,
        room.name,
      );
    }

    return room;
  }

  // 🔥 NUEVO: Aprobar solicitud de ingreso
  async approveJoinRequest(roomCode: string, username: string, approverUsername?: string): Promise<TemporaryRoom> {
    const room = await this.findByRoomCode(roomCode);

    if (!room.pendingMembers || !room.pendingMembers.includes(username)) {
      throw new NotFoundException(`No se encontró solicitud pendiente para ${username}`);
    }

    // Mover de pending a members
    room.pendingMembers = room.pendingMembers.filter(u => u !== username);

    if (!room.members) room.members = [];
    if (!room.members.includes(username)) {
      room.members.push(username);
    }

    // Opcional: Agregar también a assignedMembers si se requiere "fijarlo"
    if (room.isAssignedByAdmin) {
      if (!room.assignedMembers) room.assignedMembers = [];
      if (!room.assignedMembers.includes(username)) {
        room.assignedMembers.push(username);
      }
    }

    room.currentMembers = room.members.length;
    await this.temporaryRoomRepository.save(room);

    // Notificar aprobación
    if (this.socketGateway && this.socketGateway.notifyUserApproved) {
      this.socketGateway.notifyUserApproved(roomCode, username);
    }

    return room;
  }

  // 🔥 NUEVO: Agregar usuario directamente (bypassing pending) - Para admins
  async addMemberDirectly(roomCode: string, username: string): Promise<TemporaryRoom> {
    console.log(`🔧 addMemberDirectly: Agregando ${username} directamente a sala ${roomCode}`);

    const room = await this.findByRoomCode(roomCode);

    // Inicializar arrays si no existen
    if (!room.members) room.members = [];
    if (!room.connectedMembers) room.connectedMembers = [];
    if (!room.pendingMembers) room.pendingMembers = [];

    // Verificar si ya es miembro
    if (room.members.includes(username)) {
      console.log(`✅ Usuario ${username} ya es miembro, solo agregando a connectedMembers`);

      // Solo agregar a connectedMembers si no está
      if (!room.connectedMembers.includes(username)) {
        room.connectedMembers.push(username);
        await this.temporaryRoomRepository.save(room);
      }

      return room;
    }

    // Verificar capacidad
    if (room.members.length >= room.maxCapacity) {
      throw new BadRequestException(`La sala ha alcanzado su capacidad máxima (${room.maxCapacity} usuarios)`);
    }

    // Agregar directamente a members (sin pasar por pending)
    room.members.push(username);
    room.connectedMembers.push(username);

    // Remover de pendingMembers si estaba ahí
    if (room.pendingMembers.includes(username)) {
      room.pendingMembers = room.pendingMembers.filter(u => u !== username);
      console.log(`🧹 Usuario ${username} removido de pendingMembers`);
    }

    room.currentMembers = room.members.length;
    await this.temporaryRoomRepository.save(room);

    console.log(`✅ Usuario ${username} agregado directamente a sala ${roomCode}. Total miembros: ${room.currentMembers}`);

    // Notificar a través del socket gateway
    if (this.socketGateway) {
      this.socketGateway.notifyUserAddedToRoom(username, room.roomCode, room.name);
    }

    return room;
  }

  // 🔥 NUEVO: Rechazar solicitud de ingreso
  async rejectJoinRequest(roomCode: string, username: string): Promise<TemporaryRoom> {
    const room = await this.findByRoomCode(roomCode);

    if (room.pendingMembers && room.pendingMembers.includes(username)) {
      room.pendingMembers = room.pendingMembers.filter(u => u !== username);
      await this.temporaryRoomRepository.save(room);
    }

    return room;
  }

  // 🔥 NUEVO: Validar acceso estricto a la sala
  async validateUserAccess(roomCode: string, username: string): Promise<void> {
    const room = await this.temporaryRoomRepository.findOne({ where: { roomCode } });

    if (!room) {
      return;
    }

    // 1. Verificar si está en pendientes
    if (room.pendingMembers && room.pendingMembers.includes(username)) {
      throw new ForbiddenException(`Tu solicitud para unirte a "${room.name}" está pendiente de aprobación.`);
    }
  }

  async leaveRoom(roomCode: string, username: string): Promise<TemporaryRoom> {
    // 🔍 LOGGING: Rastrear llamadas a leaveRoom para depuración
    console.log(`� LEAVE ROOM CALLED: User=${username}, Room=${roomCode}`);
    console.log(`📍 Stack trace:`, new Error().stack?.split('\n').slice(1, 4).join('\n'));

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
      console.log(`✅ Usuario ${username} removido de connectedMembers. Quedan: ${room.connectedMembers.length}`);
    }

    // ❌ ELIMINADO: Ya NO removemos de 'members'
    // 🔒 FIX: Mantener usuario en 'members' para evitar que se salgan automáticamente
    // Solo 'removeUserFromRoom' (admin) puede eliminar permanentemente
    console.log(`🔒 Usuario ${username} MANTIENE acceso a la sala (members: ${room.members?.length || 0})`);

    // Actualizar conteo basado en miembros reales (no cambia si no removemos de members)
    room.currentMembers = room.members?.length || 0;

    await this.temporaryRoomRepository.save(room);
    console.log(`✅ leaveRoom completado: ${username} desconectado pero sigue siendo miembro`);

    // Limpiar la sala actual del usuario en la base de datos
    try {
      const user = await this.userRepository.findOne({ where: { username } });
      if (user && user.currentRoomCode === roomCode) {
        user.currentRoomCode = null;
        await this.userRepository.save(user);
        console.log(`✅ Sala actual del usuario ${username} limpiada en BD`);
      }
    } catch (error) {
      console.error(`❌ Error al limpiar sala actual del usuario ${username}:`, error);
    }

    return room;
  }

  async removeUserFromRoom(roomCode: string, username: string, removedBy?: string): Promise<any> {
    const room = await this.findByRoomCode(roomCode);

    if (!room) {
      throw new NotFoundException('Sala no encontrada');
    }

    // Remover el usuario de connectedMembers
    if (room.connectedMembers && room.connectedMembers.includes(username)) {
      room.connectedMembers = room.connectedMembers.filter(
        (u) => u !== username,
      );
      // 👈 MODIFICADO: currentMembers debe ser el total de usuarios AÑADIDOS (members), no solo conectados
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

    // 🔥 NUEVO: Remover de favoritos automáticamente al ser expulsado
    try {
      await this.roomFavoritesService.removeFavorite(username, roomCode);
    } catch (error) {
      console.error(`❌ Error al remover favorito de usuario expulsado (${username}):`, error);
    }

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

    // Notificar a través del socket gateway con roomName y removedBy
    if (this.socketGateway) {
      this.socketGateway.handleUserRemovedFromRoom(roomCode, username, room.name, removedBy);
    }

    return {
      message: `Usuario ${username} eliminado de la sala ${room.name}`,
      roomCode: room.roomCode,
      username: username,
      removedBy: removedBy || 'Administrador',
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
    role?: string, // 👈 Recibir el rol
    username?: string, // 👈 Recibir username para validar favoritos
  ): Promise<any> {

    // Obtener códigos de salas favoritas del usuario
    let favoriteRoomCodes: string[] = [];

    // 🔥 OPTIMIZACIÓN: Priorizar búsqueda por username (Login) que es único e inmutable
    if (username) {
      try {
        favoriteRoomCodes = await this.roomFavoritesService.getUserFavoriteRoomCodes(username);
      } catch (error) {
        console.error('Error al obtener favoritos por username:', error);
      }
    }
    // Fallback a displayName si no hay username (para retrocompatibilidad)
    else if (displayName) {
      try {
        favoriteRoomCodes = await this.roomFavoritesService.getUserFavoriteRoomCodes(displayName);
      } catch (error) {
        console.error('Error al obtener favoritos por displayName:', error);
      }
    }

    // Construir condiciones de bsqueda
    let whereConditions: any = { isActive: true };

    if (search && search.trim()) {
      whereConditions = [
        { isActive: true, name: Like(`%${search}%`) },
        { isActive: true, roomCode: Like(`%${search}%`) },
      ];
    }

    // ?? NOTA: El filtrado por rol se hace en memoria despus del JOIN (lneas 631-639)
    // para evitar problemas de compatibilidad SQL

    // ?? RESTAURADO: Necesitamos el JOIN para ordenar por ltimo mensaje, aunque no lo devolvamos
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
        'message.sentAt', // Solo seleccionamos sentAt para el ordenamiento
      ])
      .where('room.isActive = :isActive', { isActive: true });

    // Aplicar búsqueda si existe (busca en nombre y código) - Nota: ya no buscamos en mensaje para optimizar
    if (search && search.trim()) {
      queryBuilder.andWhere(
        '(room.name LIKE :search OR room.roomCode LIKE :search)',
        { search: `%${search}%` },
      );
    }

    // FILTRADO POR ROL (Movido a lgica en memoria para evitar problemas de compatibilidad SQL)
    // if (['ADMIN', 'JEFEPISO'].includes(role)) { ... }

    // Obtener todas las salas
    const { entities, raw } = await queryBuilder.getRawAndEntities();

    // Mapear resultados
    const allRooms = entities.map((room, index) => {
      // ?? FILTRADO POR ROL EN MEMORIA
      if (['ADMIN', 'JEFEPISO'].includes(role)) {
        const userFullName = displayName || '';
        const members = room.members || [];
        if (!members.includes(userFullName)) {
          return null; // Filtrar si no es miembro
        }
      }

      const rowData = raw[index];
      // Obtenemos la fecha del último mensaje para ordenar
      const lastMessageSentAt = rowData.message_sentAt;

      // 🔥 OPTIMIZACIÓN: NO devolver arrays pesados de members/connectedMembers
      // Solo devolver contadores para reducir payload ~83%
      return {
        id: room.id,
        name: room.name,
        description: room.description, // 🔥 RESTAURADO: description para el frontend es el picture
        roomCode: room.roomCode,
        currentMembers: room.currentMembers,
        maxCapacity: room.maxCapacity, // 🔥 AGREGADO: maxCapacity para el frontend
        isActive: room.isActive,
        // isMuted: room.settings?.mutedUsers?.includes(displayName) || false, // 🔥 Estado de silencio
        _sortTime: lastMessageSentAt ? new Date(lastMessageSentAt).getTime() : 0 // CAMPO TEMPORAL PARA ORDENAR
      };
    }).filter(room => room !== null); // Eliminar nulos del filtrado

    // Separar favoritas y no favoritas
    const favorites = allRooms.filter((room) =>
      favoriteRoomCodes.includes(room.roomCode),
    );
    const nonFavorites = allRooms.filter(
      (room) => !favoriteRoomCodes.includes(room.roomCode),
    );

    // Función de ordenamiento RESTAURADA
    const sortByLastMessage = (rooms) => {
      return rooms.sort((a, b) => {
        return b._sortTime - a._sortTime;
      });
    };

    // 🔥 MODIFICADO: Solo ordenar los NO-favoritos (favoritos van a su propia API)
    const sortedNonFavorites = sortByLastMessage(nonFavorites);

    // 🔥 MODIFICADO: Solo paginar los NO-favoritos
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    // Paginamos y eliminamos el campo temporal _sortTime
    const paginatedRooms = sortedNonFavorites
      .slice(skip, skip + limitNum)
      .map(({ _sortTime, ...rest }) => rest);

    // 🔥 NUEVO: Calcular unreadCount para cada sala paginada
    // Esto resuelve el bug donde SUPERADMIN ve contadores incorrectos después de F5
    if (username && paginatedRooms.length > 0) {
      const roomCodes = paginatedRooms.map(room => room.roomCode);
      const unreadCounts = await this.messagesService.getUnreadCountsForUserInRooms(
        roomCodes,
        username,
      );

      // Agregar unreadCount a cada sala
      paginatedRooms.forEach(room => {
        room['unreadCount'] = unreadCounts[room.roomCode] || 0;
      });
    }

    return {
      data: paginatedRooms, // 🔥 Solo NO-favoritos
      total: nonFavorites.length, // 🔥 Total de NO-favoritos
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(nonFavorites.length / limit),
    };
  }

  // ?? NUEVO: Endpoint para obtener miembros de una sala especfica
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

        // 2. 🔥 CLUSTER FIX: Mapear usuarios usando verificación async de estado online
        // Usar Promise.all para verificar estado online en Redis (cluster)
        userList = await Promise.all(
          allUsernames.map(async (username, index) => {
            // Buscar datos en la respuesta de BD
            const dbUser = dbUsers.find((u) => u.username === username);

            // 🔥 Verificar estado online en tiempo real (ahora incluye Redis para cluster)
            const isOnline = this.socketGateway
              ? await this.socketGateway.isUserOnlineAsync(username)
              : false;

            if (dbUser) {
              return {
                id: dbUser.id,
                displayName: dbUser.nombre && dbUser.apellido
                  ? `${dbUser.nombre} ${dbUser.apellido} `
                  : dbUser.username,
                isOnline: isOnline,
                role: dbUser.role,
                numeroAgente: dbUser.numeroAgente,
                picture: dbUser.picture || null,
                email: dbUser.email,
              };
            } else {
              // Fallback para usuarios que no están en la BD (ej. usuarios temporales antiguos)
              return {
                id: index + 1, // ID temporal
                displayName: username === 'Usuario' ? `Usuario ${index + 1} ` : username,
                isOnline: isOnline,
                role: 'GUEST',
                numeroAgente: null
              };
            }
          })
        );
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
      // 🚀 MODIFICADO: Usar LIKE para mayor flexibilidad con mayúsculas/minúsculas y displayNames
      // JSON_CONTAINS es demasiado estricto y falla si hay diferencias de case o si se guardó el FullName
      const rooms = await this.temporaryRoomRepository
        .createQueryBuilder('room')
        .where('room.isActive = :isActive', { isActive: true })
        .andWhere(
          '(room.members LIKE :pattern OR room.connectedMembers LIKE :pattern OR room.assignedMembers LIKE :pattern)',
          { pattern: `%${username}%` }
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

  // 🔥 NUEVO: Silenciar sala para un usuario
  async muteRoom(roomCode: string, username: string): Promise<any> {
    const room = await this.findByRoomCode(roomCode);

    if (!room.settings) {
      room.settings = {};
    }

    if (!room.settings.mutedUsers) {
      room.settings.mutedUsers = [];
    }

    if (!room.settings.mutedUsers.includes(username)) {
      room.settings.mutedUsers.push(username);
      await this.temporaryRoomRepository.save(room);
    }

    return { success: true, isMuted: true, roomCode };
  }

  // 🔥 NUEVO: Desactivar silencio de sala para un usuario
  async unmuteRoom(roomCode: string, username: string): Promise<any> {
    const room = await this.findByRoomCode(roomCode);

    if (room.settings && room.settings.mutedUsers) {
      room.settings.mutedUsers = room.settings.mutedUsers.filter(u => u !== username);
      await this.temporaryRoomRepository.save(room);
    }

    return { success: true, isMuted: false, roomCode };
  }
}
