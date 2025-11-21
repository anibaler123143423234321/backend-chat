import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { TemporaryRoomsService } from '../temporary-rooms/temporary-rooms.service';
import { MessagesService } from '../messages/messages.service';
import { TemporaryConversationsService } from '../temporary-conversations/temporary-conversations.service';
import { User } from '../users/entities/user.entity';
import { getPeruDate, formatPeruTime } from '../utils/date.utils';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  transports: ['websocket', 'polling'],
  path: '/socket.io/',
})
@Injectable()
export class SocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer() server: Server;

  // Mapas para el chat
  private users = new Map<
    string,
    { socket: Socket; userData: any; currentRoom?: string }
  >();
  private groups = new Map<string, Set<string>>();
  private temporaryLinks = new Map<string, any>();
  private publicRooms = new Map<string, any>();
  private roomUsers = new Map<string, Set<string>>(); // roomCode -> Set<usernames>
  // 🔥 NUEVO: Caché de mensajes recientes para detección de duplicados
  private recentMessages = new Map<string, number>(); // messageHash -> timestamp

  // 🔥 NUEVO: Método público para verificar si un usuario está conectado
  public isUserOnline(username: string): boolean {
    return this.users.has(username);
  }

  constructor(
    private temporaryRoomsService: TemporaryRoomsService,
    private messagesService: MessagesService,
    private temporaryConversationsService: TemporaryConversationsService,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {
    // Limpiar enlaces expirados cada 5 minutos
    setInterval(() => this.cleanExpiredLinks(), 5 * 60 * 1000);

    // 🔥 NUEVO: Limpiar caché de mensajes cada 10 segundos
    setInterval(() => this.cleanRecentMessagesCache(), 10 * 1000);

    // Inyectar referencia del gateway en el servicio para notificaciones
    this.temporaryRoomsService.setSocketGateway(this);
  }

  // 🔥 NUEVO: Cargar grupos al iniciar el servidor
  async afterInit(_server: Server) {
    console.log('🚀 Inicializando Socket Gateway...');
    try {
      // Cargar todas las salas temporales como grupos
      const rooms = await this.temporaryRoomsService.findAll();
      // console.log(`📦 Cargando ${rooms.length} salas/grupos desde BD...`);

      let totalMembers = 0;
      rooms.forEach((room) => {
        const members = new Set(room.members || []);
        this.groups.set(room.name, members);
        totalMembers += members.size;
        // 🔥 Solo mostrar log detallado en modo desarrollo
        if (process.env.NODE_ENV === 'development') {
          console.log(`   ✓ "${room.name}" (${members.size} miembros)`);
        }
      });

      console.log(
        `✅ Socket Gateway inicializado: ${this.groups.size} salas, ${totalMembers} miembros totales`,
      );
    } catch (error) {
      console.error('❌ Error al cargar grupos en afterInit:', error);
    }
  }

  async handleDisconnect(client: Socket) {
    // Remover usuario del chat si existe
    for (const [username, user] of this.users.entries()) {
      if (user.socket === client) {
        console.log(`🔌 Desconectando usuario: ${username}`);

        // Si el usuario estaba en una sala, solo removerlo de la memoria (NO de la BD)
        if (user.currentRoom) {
          const roomCode = user.currentRoom;
          // console.log(`🏠 Usuario ${username} estaba en sala ${roomCode}`);

          // NO remover de la base de datos - mantener en el historial
          // Solo remover de la memoria para marcarlo como desconectado
          const roomUsersSet = this.roomUsers.get(roomCode);
          if (roomUsersSet) {
            roomUsersSet.delete(username);
            // console.log(`✅ Usuario ${username} removido de sala en memoria`);

            if (roomUsersSet.size === 0) {
              this.roomUsers.delete(roomCode);
              console.log(
                `✅ Sala ${roomCode} removida de memoria (sin usuarios)`,
              );
            }
          }

          // Notificar a otros usuarios de la sala que este usuario se desconectó
          await this.broadcastRoomUsers(roomCode);
        }

        // Remover usuario del mapa de usuarios conectados
        this.users.delete(username);
        // console.log(`✅ Usuario ${username} removido del mapa de usuarios`);

        // 🔥 Obtener todas las conversaciones asignadas para actualizar correctamente la lista de usuarios
        try {
          const allAssignedConversations =
            await this.temporaryConversationsService.findAll();
          await this.broadcastUserList(allAssignedConversations);
        } catch (error) {
          console.error(
            '❌ Error al obtener conversaciones asignadas en handleDisconnect:',
            error,
          );
          this.broadcastUserList();
        }
        break;
      }
    }
  }

  handleConnection(_client: Socket) {
    // Socket.IO connection established
  }

  // ===== EVENTOS DEL CHAT =====

  @SubscribeMessage('register')
  async handleRegister(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { username: string; userData: any; assignedConversations?: any[] },
  ) {
    console.log(`📝 WS: register - Usuario: ${data.username}`);
    const { username, userData, assignedConversations } = data;
    this.users.set(username, { socket: client, userData });

    // 🔥 Guardar o actualizar usuario en la base de datos con numeroAgente y role
    try {
      let dbUser = await this.userRepository.findOne({ where: { username } });

      if (dbUser) {
        // Actualizar usuario existente
        dbUser.nombre = userData?.nombre || dbUser.nombre;
        dbUser.apellido = userData?.apellido || dbUser.apellido;
        dbUser.email = userData?.email || dbUser.email;
        dbUser.role = userData?.role || dbUser.role;
        dbUser.numeroAgente = userData?.numeroAgente || dbUser.numeroAgente;
        await this.userRepository.save(dbUser);
      } else {
        // Crear nuevo usuario
        dbUser = this.userRepository.create({
          username,
          nombre: userData?.nombre,
          apellido: userData?.apellido,
          email: userData?.email,
          role: userData?.role,
          numeroAgente: userData?.numeroAgente,
        });
        await this.userRepository.save(dbUser);
      }
    } catch (error) {
      console.error(`❌ Error al guardar usuario ${username} en BD:`, error);
    }

    // 🔥 NUEVO: Restaurar salas del usuario desde BD
    try {
      const allRooms = await this.temporaryRoomsService.findAll();
      const userRooms = allRooms.filter(
        (room) =>
          (room.connectedMembers && room.connectedMembers.includes(username)) ||
          (room.members && room.members.includes(username)),
      );

      if (userRooms.length > 0) {
        const roomNames = userRooms.map((r) => r.name).join(', ');
        console.log(
          `🏠 Restaurando ${userRooms.length} salas para ${username}: [${roomNames}]`,
        );
      }

      for (const room of userRooms) {
        // Agregar usuario a la sala en memoria
        if (!this.roomUsers.has(room.roomCode)) {
          this.roomUsers.set(room.roomCode, new Set());
        }
        this.roomUsers.get(room.roomCode)!.add(username);
        // 🔥 Solo mostrar log detallado en modo desarrollo
        if (process.env.NODE_ENV === 'development') {
          console.log(`   ✓ "${room.name}" (${room.roomCode})`);
        }
      }

      // Si el usuario estaba en una sala, actualizar su currentRoom
      if (userRooms.length > 0) {
        const user = this.users.get(username);
        if (user) {
          user.currentRoom = userRooms[0].roomCode;
          console.log(
            `✅ Sala actual del usuario restaurada a ${userRooms[0].roomCode}`,
          );
        }
      }
    } catch (error) {
      console.error(`❌ Error al restaurar salas para ${username}:`, error);
    }

    // Enviar confirmación de registro
    client.emit('info', {
      message: `Registrado como ${username}`,
    });

    // 🔥 CORREGIDO: Enviar userList actualizado a TODOS los usuarios conectados
    // para que vean al nuevo usuario conectado en tiempo real
    try {
      const allAssignedConversations =
        await this.temporaryConversationsService.findAll();
      await this.broadcastUserList(allAssignedConversations);
    } catch (error) {
      console.error(
        '❌ Error al obtener conversaciones asignadas en handleRegister:',
        error,
      );
      this.broadcastUserList(assignedConversations);
    }
  }

  @SubscribeMessage('requestUserListPage')
  handleRequestUserListPage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { page: number; pageSize: number },
  ) {
    console.log(
      `📄 WS: requestUserListPage - Página: ${data.page}, Tamaño: ${data.pageSize}`,
    );

    // Obtener el usuario que hace la petición
    let requestingUser = null;
    for (const [username, { socket, userData }] of this.users.entries()) {
      if (socket.id === client.id) {
        requestingUser = { username, userData };
        break;
      }
    }

    if (!requestingUser) {
      console.log('❌ Usuario no encontrado');
      return;
    }

    // Verificar que sea admin
    const isAdmin =
      requestingUser.userData?.role &&
      requestingUser.userData.role.toString().toUpperCase().trim() === 'ADMIN';

    if (!isAdmin) {
      console.log('❌ Usuario no es admin');
      return;
    }

    // Crear lista de usuarios con toda su información
    const userListWithData = Array.from(this.users.entries()).map(
      ([username, { userData }]) => ({
        id: userData?.id || null,
        username: username,
        nombre: userData?.nombre || null,
        apellido: userData?.apellido || null,
        email: userData?.email || null,
        role: userData?.role || 'USER',
        picture: userData?.picture || null,
        sede: userData?.sede || null,
        sede_id: userData?.sede_id || null,
        numeroAgente: userData?.numeroAgente || null,
      }),
    );

    // Paginar
    const page = data.page || 0;
    const pageSize = data.pageSize || 10;
    const start = page * pageSize;
    const end = start + pageSize;
    const paginatedUsers = userListWithData.slice(start, end);

    // Enviar página solicitada
    client.emit('userListPage', {
      users: paginatedUsers,
      page: page,
      pageSize: pageSize,
      totalUsers: userListWithData.length,
      hasMore: end < userListWithData.length,
    });
  }

  @SubscribeMessage('updateAssignedConversations')
  async handleUpdateAssignedConversations(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { username: string; assignedConversations: any[] },
  ) {
    console.log(
      `🔄 WS: updateAssignedConversations - Usuario: ${data.username}`,
    );

    // Actualizar la lista de usuarios para este usuario específico
    const userConnection = this.users.get(data.username);
    if (userConnection && userConnection.socket.connected) {
      // Crear lista de usuarios conectados con toda su información
      const connectedUsersMap = new Map<string, any>();
      Array.from(this.users.entries()).forEach(([uname, { userData }]) => {
        connectedUsersMap.set(uname, {
          id: userData?.id || null,
          username: uname,
          nombre: userData?.nombre || null,
          apellido: userData?.apellido || null,
          email: userData?.email || null,
          role: userData?.role || 'USER',
          picture: userData?.picture || null,
          sede: userData?.sede || null,
          sede_id: userData?.sede_id || null,
          numeroAgente: userData?.numeroAgente || null,
          isOnline: true, // Usuario conectado
        });
      });

      // Incluir información del usuario actual + usuarios de conversaciones asignadas
      const usersToSend = [];

      // Agregar información del usuario actual
      const ownUserData = connectedUsersMap.get(data.username);
      if (ownUserData) {
        usersToSend.push(ownUserData);
      }

      // Agregar información de los otros usuarios en las conversaciones asignadas
      if (data.assignedConversations && data.assignedConversations.length > 0) {
        for (const conv of data.assignedConversations) {
          if (conv.participants && Array.isArray(conv.participants)) {
            for (const participantName of conv.participants) {
              if (participantName !== data.username) {
                // Verificar si ya está en la lista
                if (usersToSend.some((u) => u.username === participantName)) {
                  continue;
                }

                // Primero buscar en usuarios conectados
                const participantData = connectedUsersMap.get(participantName);

                if (participantData) {
                  // Usuario está conectado
                  usersToSend.push(participantData);
                } else {
                  // Usuario NO está conectado, buscar en la base de datos
                  try {
                    // Buscar por nombre completo (participantName puede ser "Nombre Apellido")
                    const dbUser = await this.userRepository
                      .createQueryBuilder('user')
                      .where(
                        'CONCAT(user.nombre, " ", user.apellido) = :fullName',
                        { fullName: participantName },
                      )
                      .orWhere('user.username = :username', {
                        username: participantName,
                      })
                      .getOne();

                    if (dbUser) {
                      const fullName =
                        dbUser.nombre && dbUser.apellido
                          ? `${dbUser.nombre} ${dbUser.apellido}`
                          : dbUser.username;

                      // 🔥 CORREGIDO: Verificar si el usuario está conectado
                      const isUserConnected =
                        this.users.has(fullName) ||
                        this.users.has(dbUser.username);

                      // Agregar usuario de la BD con estado de conexión correcto
                      usersToSend.push({
                        id: dbUser.id || null,
                        username: fullName,
                        nombre: dbUser.nombre || null,
                        apellido: dbUser.apellido || null,
                        email: dbUser.email || null,
                        role: dbUser.role || 'USER', // 🔥 Obtener role de la BD
                        picture: null, // No tenemos picture en la entidad User de chat
                        sede: null,
                        sede_id: null,
                        numeroAgente: dbUser.numeroAgente || null, // 🔥 Obtener numeroAgente de la BD
                        isOnline: isUserConnected, // 🔥 CORREGIDO: Estado de conexión real
                      });
                    }
                  } catch (error) {
                    console.error(
                      `❌ Error al buscar usuario ${participantName} en BD:`,
                      error,
                    );
                  }
                }
              }
            }
          }
        }
      }

      console.log(
        `📤 Enviando lista de usuarios a ${data.username}:`,
        usersToSend.map(
          (u) => `${u.username} (${u.isOnline ? 'online' : 'offline'})`,
        ),
      );
      userConnection.socket.emit('userList', { users: usersToSend });
    }
  }

  @SubscribeMessage('conversationAssigned')
  handleConversationAssigned(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      user1: string;
      user2: string;
      conversationName: string;
      linkId: string;
      assignedConversations?: any[];
    },
  ) {
    console.log(
      `💬 WS: conversationAssigned - ${data.conversationName} entre ${data.user1} y ${data.user2}`,
    );

    // Notificar a ambos usuarios
    const user1Connection = this.users.get(data.user1);
    const user2Connection = this.users.get(data.user2);

    const notificationData = {
      conversationName: data.conversationName,
      linkId: data.linkId,
      otherUser: '',
      message: `Se te ha asignado una conversación: ${data.conversationName}`,
    };

    if (user1Connection && user1Connection.socket.connected) {
      user1Connection.socket.emit('newConversationAssigned', {
        ...notificationData,
        otherUser: data.user2,
      });
    }

    if (user2Connection && user2Connection.socket.connected) {
      user2Connection.socket.emit('newConversationAssigned', {
        ...notificationData,
        otherUser: data.user1,
      });
    }

    // 🔥 NUEVO: Actualizar la lista de usuarios de ambos participantes para que se vean mutuamente
    // Esto asegura que ambos usuarios vean al otro en su lista inmediatamente después de la asignación
    const userListWithData = Array.from(this.users.entries()).map(
      ([username, { userData }]) => {
        // Calcular el nombre completo para comparación
        const fullName =
          userData?.nombre && userData?.apellido
            ? `${userData.nombre} ${userData.apellido}`
            : username;

        return {
          id: userData?.id || null,
          username: username,
          fullName: fullName, // Agregar fullName para comparación
          nombre: userData?.nombre || null,
          apellido: userData?.apellido || null,
          email: userData?.email || null,
          role: userData?.role || 'USER',
          picture: userData?.picture || null,
          sede: userData?.sede || null,
          sede_id: userData?.sede_id || null,
          numeroAgente: userData?.numeroAgente || null,
        };
      },
    );

    // Actualizar lista de user1 para incluir a user2
    if (user1Connection && user1Connection.socket.connected) {
      const isAdmin =
        user1Connection.userData?.role?.toString().toUpperCase().trim() ===
        'ADMIN';

      if (!isAdmin) {
        // Para usuarios no admin, enviar lista actualizada con el otro participante
        const usersToSend = [];

        // Agregar información del usuario actual (buscar por username o fullName)
        const ownUserData = userListWithData.find(
          (u) => u.username === data.user1 || u.fullName === data.user1,
        );
        if (ownUserData) {
          // Remover fullName antes de enviar
          const { fullName: _fullName1, ...userDataToSend } = ownUserData;
          usersToSend.push(userDataToSend);
        }

        // Agregar información del otro participante (buscar por username o fullName)
        const user2Data = userListWithData.find(
          (u) => u.username === data.user2 || u.fullName === data.user2,
        );
        if (user2Data) {
          // Remover fullName antes de enviar
          const { fullName: _fullName2, ...userDataToSend } = user2Data;
          usersToSend.push(userDataToSend);
        }

        console.log(
          `🔄 Actualizando lista de usuarios para ${data.user1}:`,
          usersToSend.map((u) => u.username),
        );
        user1Connection.socket.emit('userList', { users: usersToSend });
      }
    }

    // Actualizar lista de user2 para incluir a user1
    if (user2Connection && user2Connection.socket.connected) {
      const isAdmin =
        user2Connection.userData?.role?.toString().toUpperCase().trim() ===
        'ADMIN';

      if (!isAdmin) {
        // Para usuarios no admin, enviar lista actualizada con el otro participante
        const usersToSend = [];

        // Agregar información del usuario actual (buscar por username o fullName)
        const ownUserData = userListWithData.find(
          (u) => u.username === data.user2 || u.fullName === data.user2,
        );
        if (ownUserData) {
          // Remover fullName antes de enviar
          const { fullName: _fullName3, ...userDataToSend } = ownUserData;
          usersToSend.push(userDataToSend);
        }

        // Agregar información del otro participante (buscar por username o fullName)
        const user1Data = userListWithData.find(
          (u) => u.username === data.user1 || u.fullName === data.user1,
        );
        if (user1Data) {
          // Remover fullName antes de enviar
          const { fullName: _fullName4, ...userDataToSend } = user1Data;
          usersToSend.push(userDataToSend);
        }

        console.log(
          `🔄 Actualizando lista de usuarios para ${data.user2}:`,
          usersToSend.map((u) => u.username),
        );
        user2Connection.socket.emit('userList', { users: usersToSend });
      }
    }
  }

  @SubscribeMessage('conversationUpdated')
  handleConversationUpdated(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      participants: string[];
      conversationName: string;
      conversationId: string;
    },
  ) {
    console.log(
      `🔄 WS: conversationUpdated - ${data.conversationName} (ID: ${data.conversationId})`,
    );

    // Notificar a todos los participantes que la conversación fue actualizada
    if (data.participants && Array.isArray(data.participants)) {
      data.participants.forEach((participantName) => {
        const participantConnection = this.users.get(participantName);
        if (participantConnection && participantConnection.socket.connected) {
          participantConnection.socket.emit('conversationDataUpdated', {
            conversationId: data.conversationId,
            conversationName: data.conversationName,
            message: `La conversación "${data.conversationName}" ha sido actualizada`,
          });
        }
      });
    }

    // También notificar a todos los ADMIN
    this.users.forEach(({ socket, userData }) => {
      const role = userData?.role?.toString().toUpperCase().trim();
      if (socket.connected && role === 'ADMIN') {
        socket.emit('conversationDataUpdated', {
          conversationId: data.conversationId,
          conversationName: data.conversationName,
          message: `La conversación "${data.conversationName}" ha sido actualizada`,
        });
      }
    });
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { from: string; to: string; isTyping: boolean; roomCode?: string },
  ) {
    // Si es un mensaje de sala (roomCode presente)
    if (data.roomCode) {
      const roomUsers = this.roomUsers.get(data.roomCode);
      if (roomUsers) {
        // Emitir a todos los usuarios de la sala excepto al que está escribiendo
        roomUsers.forEach((member) => {
          if (member !== data.from) {
            const memberUser = this.users.get(member);
            if (memberUser && memberUser.socket.connected) {
              memberUser.socket.emit('roomTyping', {
                from: data.from,
                roomCode: data.roomCode,
                isTyping: data.isTyping,
              });
            }
          }
        });
      }
    } else {
      // Mensaje directo (1 a 1)
      const recipientConnection = this.users.get(data.to);

      if (recipientConnection && recipientConnection.socket.connected) {
        recipientConnection.socket.emit('userTyping', {
          from: data.from,
          isTyping: data.isTyping,
        });
      }
    }
  }

  @SubscribeMessage('message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    console.log(
      `📨 WS: message - De: ${data.from}, Para: ${data.to}, Grupo: ${data.isGroup}`,
    );

    // 🔥 NUEVO: Verificar si es un mensaje duplicado
    if (this.isDuplicateMessage(data)) {
      console.log('⚠️ Mensaje duplicado ignorado por el backend');
      return; // Ignorar el mensaje duplicado
    }

    console.log(`📦 Datos completos del mensaje:`, {
      from: data.from,
      to: data.to,
      isGroup: data.isGroup,
      isAssignedConversation: data.isAssignedConversation,
      actualRecipient: data.actualRecipient,
      message: data.message?.substring(0, 50),
    });

    const {
      to,
      message,
      isGroup,
      time,
      from,
      mediaType,
      mediaData,
      fileName,
      fileSize,
      replyToMessageId,
      replyToSender,
      replyToText,
      roomCode: messageRoomCode, // 🔥 roomCode del mensaje (si viene del frontend)
    } = data;

    // 🔥 Obtener información del remitente (role y numeroAgente)
    const senderUser = this.users.get(from);
    let senderRole = senderUser?.userData?.role || null;
    let senderNumeroAgente = senderUser?.userData?.numeroAgente || null;

    console.log(`🔍 DEBUG - Usuario en memoria:`, {
      from,
      hasSenderUser: !!senderUser,
      userData: senderUser?.userData,
      senderRole,
      senderNumeroAgente,
    });

    // 🔥 OPTIMIZACIÓN: Cachear información del usuario para evitar consultas repetidas a BD
    if (!senderRole || !senderNumeroAgente) {
      // Primero verificar si ya tenemos el usuario en memoria (de una conexión anterior)
      const cachedUser = this.users.get(from);
      if (cachedUser?.userData?.role && cachedUser?.userData?.numeroAgente) {
        senderRole = cachedUser.userData.role;
        senderNumeroAgente = cachedUser.userData.numeroAgente;
      } else {
        // Solo consultar BD si no está en caché
        try {
          const dbUser = await this.userRepository.findOne({
            where: { username: from },
          });

          if (dbUser) {
            senderRole = dbUser.role || senderRole;
            senderNumeroAgente = dbUser.numeroAgente || senderNumeroAgente;
            console.log(
              `✅ Información del remitente obtenida de BD: role=${senderRole}, numeroAgente=${senderNumeroAgente}`,
            );

            // 🔥 Cachear en memoria para futuras consultas
            if (cachedUser) {
              cachedUser.userData = {
                ...cachedUser.userData,
                role: senderRole,
                numeroAgente: senderNumeroAgente,
              };
            }
          } else {
            console.warn(`⚠️ Usuario ${from} no encontrado en BD`);
          }
        } catch (error) {
          console.error(`❌ Error al buscar usuario en BD:`, error);
        }
      }
    }

    // 🔥 CRÍTICO: Determinar el roomCode ANTES de guardar en BD
    const user = this.users.get(from);
    const finalRoomCode = messageRoomCode || user?.currentRoom;

    console.log(`🔥 DEBUG - finalRoomCode calculado: "${finalRoomCode}" (messageRoomCode: "${messageRoomCode}", currentRoom: "${user?.currentRoom}")`);

    // 🔥 GUARDAR MENSAJE EN BD PRIMERO para obtener el ID
    let savedMessage = null;
    try {
      savedMessage = await this.saveMessageToDatabase({
        ...data,
        roomCode: finalRoomCode, // 🔥 Usar roomCode correcto
        senderRole, // 🔥 Incluir role del remitente
        senderNumeroAgente, // 🔥 Incluir numeroAgente del remitente
      });
      console.log(`✅ Mensaje guardado en BD con ID: ${savedMessage?.id}`);
    } catch (error) {
      console.error(`❌ Error al guardar mensaje en BD:`, error);
    }

    if (isGroup) {
      console.log(`🔵 Procesando mensaje de GRUPO`);

      console.log(`👤 Usuario remitente:`, {
        username: from,
        messageRoomCode, // Ya está disponible del destructuring
        currentRoom: user?.currentRoom,
        finalRoomCode,
        hasUser: !!user,
      });

      if (finalRoomCode) {
        // Es una sala temporal
        let roomUsers = this.roomUsers.get(finalRoomCode);
        console.log(
          `🏠 Enviando a sala temporal: ${finalRoomCode}, Miembros en memoria: ${roomUsers?.size || 0}`,
        );

        // 🔥 SIEMPRE sincronizar con la base de datos para asegurar que todos reciban el mensaje
        try {
          const room =
            await this.temporaryRoomsService.findByRoomCode(finalRoomCode);
          if (room && room.connectedMembers) {
            console.log(
              `🔄 Sincronizando usuarios de BD para sala ${finalRoomCode}:`,
              room.connectedMembers,
            );

            // Combinar usuarios en memoria con usuarios de BD
            const allUsers = new Set([
              ...(roomUsers ? Array.from(roomUsers) : []),
              ...room.connectedMembers.filter((username) =>
                this.users.has(username),
              ),
            ]);

            roomUsers = allUsers;
            console.log(`✅ Total de usuarios para envío: ${roomUsers.size}`);
          }
        } catch (error) {
          console.error(
            `❌ Error al sincronizar usuarios de sala ${finalRoomCode}:`,
            error,
          );
        }

        if (roomUsers && roomUsers.size > 0) {
          console.log(
            `📋 Lista completa de usuarios en sala ${finalRoomCode}:`,
            Array.from(roomUsers),
          );

          // 🔥 Detectar menciones en el mensaje
          const mentionRegex =
            /@([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ\s]+?)(?=\s{2,}|$|[.,!?;:]|\n)/g;
          const mentions = [];
          let match;
          while ((match = mentionRegex.exec(message)) !== null) {
            mentions.push(match[1].trim());
          }
          console.log(`📢 Menciones detectadas en mensaje:`, mentions);

          roomUsers.forEach((member) => {
            const memberUser = this.users.get(member);

            // 🔥 NUEVO: Validar que el socket esté conectado
            if (
              memberUser &&
              memberUser.socket &&
              memberUser.socket.connected
            ) {
              // 🔥 Verificar si este usuario fue mencionado
              const isMentioned = mentions.some(
                (mention) =>
                  member.toUpperCase().includes(mention.toUpperCase()) ||
                  mention.toUpperCase().includes(member.toUpperCase()),
              );

              console.log(
                `✅ Enviando mensaje a ${member} en sala ${finalRoomCode}${isMentioned ? ' (MENCIONADO)' : ''} - Socket ID: ${memberUser.socket.id}`,
              );
              memberUser.socket.emit('message', {
                id: savedMessage?.id, // 🔥 Incluir ID del mensaje
                from: from || 'Usuario Desconocido',
                senderRole, // 🔥 Incluir role del remitente
                senderNumeroAgente, // 🔥 Incluir numeroAgente del remitente
                group: to,
                roomCode: finalRoomCode, // 🔥 CRÍTICO: Incluir roomCode para validación en frontend
                message,
                isGroup: true,
                time: time || formatPeruTime(),
                sentAt: savedMessage?.sentAt, // 🔥 Incluir sentAt para extraer hora correcta en frontend
                mediaType,
                mediaData,
                fileName,
                fileSize,
                replyToMessageId,
                replyToSender,
                replyToText,
                hasMention: isMentioned, // 🔥 NUEVO: Indicar si el usuario fue mencionado
                // 🔥 NUEVO: Campos de videollamada
                type: data.type,
                videoCallUrl: data.videoCallUrl,
                videoRoomID: data.videoRoomID,
                metadata: data.metadata,
              });

              // 🔥 NUEVO: Actualizar último mensaje para todos los usuarios (excepto el remitente)
              // Esto asegura que el último mensaje se actualice en tiempo real en la lista de salas
              if (member !== from) {
                // Verificar si el usuario está viendo esta sala actualmente
                const isViewingThisRoom = memberUser.currentRoom === finalRoomCode;
                // console.log(`📊 DEBUG - Usuario ${member}: currentRoom="${memberUser.currentRoom}", roomCode="${finalRoomCode}", isViewingThisRoom=${isViewingThisRoom}`);

                const lastMessageData = {
                  text: message,
                  from: from,
                  time: time || formatPeruTime(),
                  sentAt: savedMessage?.sentAt || new Date().toISOString(),
                };

                console.log(
                  `📊 DEBUG - Preparando lastMessage para ${member}:`,
                  lastMessageData,
                );
                console.log(
                  `📊 DEBUG - savedMessage?.sentAt:`,
                  savedMessage?.sentAt,
                );

                if (!isViewingThisRoom) {
                  // Usuario NO está viendo esta sala, enviar actualización con contador
                  console.log(
                    `📊 Usuario ${member} NO está viendo sala ${finalRoomCode}, enviando con contador`,
                  );
                  this.emitUnreadCountUpdateForUser(
                    finalRoomCode,
                    member,
                    1, // Incrementar contador
                    lastMessageData,
                  );
                } else {
                  // Usuario SÍ está viendo esta sala, solo actualizar último mensaje sin incrementar contador
                  console.log(
                    `📊 Usuario ${member} SÍ está viendo sala ${finalRoomCode}, enviando sin contador`,
                  );
                  this.emitUnreadCountUpdateForUser(
                    finalRoomCode,
                    member,
                    0, // No incrementar contador
                    lastMessageData,
                  );
                }
              }
            } else {
              // 🔥 NUEVO: Log cuando no se puede enviar
              console.warn(
                `⚠️ No se puede enviar mensaje a ${member}: socket no conectado o usuario no existe`,
              );
            }
          });
        } else {
          // 🔥 NUEVO: Log cuando no hay usuarios en la sala
          console.warn(`⚠️ No hay usuarios en la sala ${finalRoomCode}`);
        }
      } else {
        // Es un grupo normal
        const group = this.groups.get(to);
        console.log(
          `👥 Enviando a grupo normal: ${to}, Miembros: ${group?.size || 0}`,
        );
        if (group) {
          // 🔥 Obtener el roomCode del grupo (buscar en roomUsers)
          let groupRoomCode = null;
          for (const [code, users] of this.roomUsers.entries()) {
            if (users.has(from)) {
              groupRoomCode = code;
              break;
            }
          }

          // 🔥 Detectar menciones en el mensaje
          const mentionRegex =
            /@([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ\s]+?)(?=\s{2,}|$|[.,!?;:]|\n)/g;
          const mentions = [];
          let match;
          while ((match = mentionRegex.exec(message)) !== null) {
            mentions.push(match[1].trim());
          }
          console.log(`📢 Menciones detectadas en mensaje de grupo:`, mentions);

          const groupMembers = Array.from(group);
          groupMembers.forEach((member) => {
            const user = this.users.get(member);
            if (user && user.socket.connected) {
              // 🔥 Verificar si este usuario fue mencionado
              const isMentioned = mentions.some(
                (mention) =>
                  member.toUpperCase().includes(mention.toUpperCase()) ||
                  mention.toUpperCase().includes(member.toUpperCase()),
              );

              user.socket.emit('message', {
                id: savedMessage?.id, // 🔥 Incluir ID del mensaje
                from: from || 'Usuario Desconocido',
                senderRole, // 🔥 Incluir role del remitente
                senderNumeroAgente, // 🔥 Incluir numeroAgente del remitente
                group: to,
                roomCode: groupRoomCode, // 🔥 CRÍTICO: Incluir roomCode para validación en frontend
                message,
                isGroup: true,
                time: time || formatPeruTime(),
                sentAt: savedMessage?.sentAt, // 🔥 Incluir sentAt para extraer hora correcta en frontend
                mediaType,
                mediaData,
                fileName,
                fileSize,
                replyToMessageId,
                replyToSender,
                replyToText,
                hasMention: isMentioned, // 🔥 NUEVO: Indicar si el usuario fue mencionado
                // 🔥 NUEVO: Campos de videollamada
                type: data.type,
                videoCallUrl: data.videoCallUrl,
                videoRoomID: data.videoRoomID,
                metadata: data.metadata,
              });
            }
          });
        }
      }
    } else {
      console.log(`🔴 Procesando mensaje INDIVIDUAL (1-a-1)`);
      // Mensaje individual
      let recipientUsername = to;

      // Si es una conversación asignada, obtener el destinatario real
      if (data.isAssignedConversation && data.actualRecipient) {
        recipientUsername = data.actualRecipient;
        console.log(
          `📧 Conversación asignada detectada. Destinatario real: ${recipientUsername}`,
        );
      }

      // Log de usuarios conectados
      const connectedUsers = Array.from(this.users.keys());
      console.log(`👥 Usuarios conectados: ${connectedUsers.join(', ')}`);
      console.log(`🔍 Buscando destinatario: ${recipientUsername}`);

      // 🔥 Búsqueda case-insensitive del destinatario
      let recipient = this.users.get(recipientUsername);

      // Si no se encuentra con el nombre exacto, buscar case-insensitive
      if (!recipient) {
        const recipientNormalized = recipientUsername?.toLowerCase().trim();
        const foundUsername = Array.from(this.users.keys()).find(
          (key) => key?.toLowerCase().trim() === recipientNormalized,
        );
        if (foundUsername) {
          recipient = this.users.get(foundUsername);
          console.log(
            `✅ Usuario encontrado con búsqueda case-insensitive: ${foundUsername}`,
          );
        }
      }

      // 🔥 Preparar el objeto del mensaje para enviar
      const messageToSend = {
        id: savedMessage?.id, // 🔥 Incluir ID del mensaje guardado en BD
        from: from || 'Usuario Desconocido',
        senderRole, // 🔥 Incluir role del remitente
        senderNumeroAgente, // 🔥 Incluir numeroAgente del remitente
        to: recipientUsername,
        message,
        isGroup: false,
        time: time || formatPeruTime(),
        sentAt: savedMessage?.sentAt, // 🔥 Incluir sentAt para extraer hora correcta en frontend
        mediaType,
        mediaData,
        fileName,
        fileSize,
        replyToMessageId,
        replyToSender,
        replyToText,
        // 🔥 NUEVO: Campos de videollamada
        type: data.type,
        videoCallUrl: data.videoCallUrl,
        videoRoomID: data.videoRoomID,
        metadata: data.metadata,
      };

      // 🔥 Enviar mensaje al destinatario
      if (recipient && recipient.socket.connected) {
        console.log(
          `✅ Enviando mensaje a ${recipientUsername} (socket conectado)`,
        );
        console.log(`📦 Datos del mensaje:`, {
          id: savedMessage?.id,
          from,
          to: recipientUsername,
          message: message?.substring(0, 50),
          isGroup: false,
        });

        recipient.socket.emit('message', messageToSend);
        console.log(`✅ Mensaje emitido exitosamente a ${recipientUsername}`);
      } else {
        console.log(
          `❌ No se pudo enviar mensaje a ${recipientUsername} (usuario no conectado o no encontrado)`,
        );
        if (recipient) {
          console.log(`   Socket conectado: ${recipient.socket.connected}`);
        } else {
          console.log(`   Destinatario no encontrado en el Map de usuarios`);
        }
      }

      // 🔥 NUEVO: Enviar mensaje de vuelta al remitente para que vea su propio mensaje
      const sender = this.users.get(from);
      if (sender && sender.socket.connected) {
        console.log(
          `✅ Enviando confirmación de mensaje al remitente: ${from}`,
        );
        sender.socket.emit('message', messageToSend);
      }

      // 🔥 Emitir evento de monitoreo a todos los ADMIN/JEFEPISO
      this.broadcastMonitoringMessage({
        id: savedMessage?.id,
        from: from || 'Usuario Desconocido',
        to: recipientUsername,
        message,
        isGroup: false,
        time: time || formatPeruTime(),
        sentAt: savedMessage?.sentAt, // 🔥 Incluir sentAt para extraer hora correcta en frontend
        mediaType,
        mediaData,
        fileName,
        fileSize,
        senderRole,
        senderNumeroAgente,
        replyToMessageId,
        replyToSender,
        replyToText,
      });
    }
  }

  private async saveMessageToDatabase(data: any) {
    const {
      to,
      message,
      isGroup,
      from,
      fromId,
      senderRole, // 🔥 Extraer role del remitente
      senderNumeroAgente, // 🔥 Extraer numeroAgente del remitente
      roomCode, // 🔥 CRÍTICO: Extraer roomCode del data
      mediaType,
      mediaData,
      fileName,
      fileSize,
      replyToMessageId,
      replyToSender,
      replyToText,
      isAssignedConversation,
      actualRecipient,
      // 🔥 NUEVO: Campos de videollamada
      type,
      videoCallUrl,
      videoRoomID,
      metadata,
    } = data;

    try {
      // Si es una conversación asignada, usar el destinatario real
      let recipientForDB = to;
      if (isAssignedConversation && actualRecipient) {
        recipientForDB = actualRecipient;
      }

      console.log(
        `🔍 Guardando mensaje - isAssignedConversation: ${isAssignedConversation}, actualRecipient: ${actualRecipient}, to: ${to}, recipientForDB: ${recipientForDB}`,
      );

      // 🔥 CRÍTICO: Calcular sentAt y time desde el servidor (no confiar en el cliente)
      const peruDate = getPeruDate();
      const calculatedTime = formatPeruTime(peruDate);

      const messageData = {
        from,
        fromId,
        senderRole, // 🔥 Incluir role del remitente
        senderNumeroAgente, // 🔥 Incluir numeroAgente del remitente
        to: isGroup ? null : recipientForDB,
        message,
        isGroup,
        groupName: isGroup ? to : null,
        roomCode: isGroup ? (roomCode || this.getRoomCodeFromUser(from)) : null, // 🔥 USAR roomCode del data primero
        mediaType,
        mediaData,
        fileName,
        fileSize,
        sentAt: peruDate,
        time: calculatedTime, // 🔥 SIEMPRE calcular desde sentAt, no usar el time del cliente
        replyToMessageId,
        replyToSender,
        replyToText,
        // 🔥 NUEVO: Campos de videollamada
        type,
        videoCallUrl,
        videoRoomID,
        metadata,
      };

      console.log(`💾 Guardando mensaje en BD:`, messageData);
      console.log(`🔍 DEBUG - senderNumeroAgente antes de guardar:`, {
        senderNumeroAgente,
        senderRole,
        fromId,
        from,
      });
      const savedMessage = await this.messagesService.create(messageData);
      console.log(
        `✅ Mensaje guardado exitosamente en BD con ID: ${savedMessage.id}`,
      );
      return savedMessage; // 🔥 Retornar el mensaje guardado con su ID
    } catch (error) {
      console.error(`❌ Error al guardar mensaje en BD:`, error);
      return null;
    }
  }

  @SubscribeMessage('editMessage')
  async handleEditMessage(
    @ConnectedSocket() _client: Socket,
    @MessageBody()
    data: {
      messageId: number;
      username: string;
      newText: string;
      mediaType?: string;
      mediaData?: string;
      fileName?: string;
      fileSize?: number;
      to: string;
      isGroup: boolean;
      roomCode?: string;
    },
  ) {
    console.log(
      `✏️ WS: editMessage - ID: ${data.messageId}, Usuario: ${data.username} (solo broadcast)`,
    );

    try {
      // 🔥 OPTIMIZACIÓN: El mensaje ya fue editado en la BD por el endpoint HTTP
      // Solo necesitamos hacer broadcast del evento a los demás usuarios
      const editEvent: any = {
        messageId: data.messageId,
        newText: data.newText,
        editedAt: new Date(),
        isEdited: true,
      };

      // 🔥 Incluir campos multimedia si se proporcionan
      if (data.mediaType !== undefined) editEvent.mediaType = data.mediaType;
      if (data.mediaData !== undefined) editEvent.mediaData = data.mediaData;
      if (data.fileName !== undefined) editEvent.fileName = data.fileName;
      if (data.fileSize !== undefined) editEvent.fileSize = data.fileSize;

      if (data.isGroup && data.roomCode) {
        // Broadcast a todos los usuarios de la sala
        const roomUsersSet = this.roomUsers.get(data.roomCode);
        if (roomUsersSet) {
          roomUsersSet.forEach((user) => {
            const userConnection = this.users.get(user);
            if (userConnection && userConnection.socket.connected) {
              userConnection.socket.emit('messageEdited', editEvent);
            }
          });
          console.log(
            `✅ Broadcast de edición enviado a ${roomUsersSet.size} usuarios en sala ${data.roomCode}`,
          );
        }
      } else {
        // Enviar al destinatario individual
        const recipient = this.users.get(data.to);
        if (recipient && recipient.socket.connected) {
          recipient.socket.emit('messageEdited', editEvent);
        }
        // También enviar al remitente para sincronizar
        const sender = this.users.get(data.username);
        if (sender && sender.socket.connected) {
          sender.socket.emit('messageEdited', editEvent);
        }
        console.log(
          `✅ Notificación de edición enviada a ${data.to} y ${data.username}`,
        );
      }
    } catch (error) {
      console.error('❌ Error al hacer broadcast de mensaje editado:', error);
    }
  }

  @SubscribeMessage('deleteMessage')
  async handleDeleteMessage(
    @ConnectedSocket() _client: Socket,
    @MessageBody()
    data: {
      messageId: number;
      username: string;
      to: string;
      isGroup: boolean;
      roomCode?: string;
      isAdmin?: boolean;
      deletedBy?: string;
    },
  ) {
    console.log(
      `🗑️ WS: deleteMessage - ID: ${data.messageId}, Usuario: ${data.username}${data.isAdmin ? ' (ADMIN)' : ''}`,
    );

    try {
      // 🔥 El mensaje ya fue eliminado en la BD por el endpoint HTTP
      // Solo necesitamos hacer broadcast del evento a los demás usuarios
      const deleteEvent: any = {
        messageId: data.messageId,
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: data.deletedBy || null,
      };

      if (data.isGroup && data.roomCode) {
        // Broadcast a todos los usuarios de la sala
        const roomUsersSet = this.roomUsers.get(data.roomCode);
        if (roomUsersSet) {
          roomUsersSet.forEach((user) => {
            const userConnection = this.users.get(user);
            if (userConnection && userConnection.socket.connected) {
              userConnection.socket.emit('messageDeleted', deleteEvent);
            }
          });
          console.log(
            `✅ Broadcast de eliminación enviado a ${roomUsersSet.size} usuarios en sala ${data.roomCode}`,
          );
        }
      } else {
        // Enviar al destinatario individual
        const recipient = this.users.get(data.to);
        if (recipient && recipient.socket.connected) {
          recipient.socket.emit('messageDeleted', deleteEvent);
        }
        // También enviar al remitente para sincronizar
        const sender = this.users.get(data.username);
        if (sender && sender.socket.connected) {
          sender.socket.emit('messageDeleted', deleteEvent);
        }
        console.log(
          `✅ Notificación de eliminación enviada a ${data.to} y ${data.username}`,
        );
      }
    } catch (error) {
      console.error('❌ Error al hacer broadcast de mensaje eliminado:', error);
    }
  }

  @SubscribeMessage('createGroup')
  async handleCreateGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupName: string; members: string[]; from: string },
  ) {
    console.log(`👥 WS: createGroup - Grupo: ${data.groupName}`);
    const groupMembers = new Set(data.members);
    groupMembers.add(data.from || 'Usuario');
    this.groups.set(data.groupName, groupMembers);

    // 🔥 NUEVO: Persistir grupo en BD como sala temporal
    try {
      const createRoomDto = {
        name: data.groupName,
        maxCapacity: data.members.length + 10,
        creatorUsername: data.from,
      };

      await this.temporaryRoomsService.create(
        createRoomDto,
        1, // userId por defecto
        data.from,
      );
      console.log(`✅ Grupo "${data.groupName}" persistido en BD`);
    } catch (error) {
      console.error(`❌ Error al persistir grupo en BD:`, error);
    }

    this.broadcastGroupList();
  }

  @SubscribeMessage('joinGroup')
  async handleJoinGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupName: string; from: string },
  ) {
    console.log(
      `➕ WS: joinGroup - Usuario: ${data.from}, Grupo: ${data.groupName}`,
    );
    const groupToJoin = this.groups.get(data.groupName);
    if (groupToJoin) {
      groupToJoin.add(data.from || 'Usuario');

      // 🔥 NUEVO: Sincronizar cambios en BD
      try {
        const room = await this.temporaryRoomsService.findByName(
          data.groupName,
        );
        if (room) {
          const updatedMembers = Array.from(groupToJoin);
          await this.temporaryRoomsService.updateRoomMembers(room.id, {
            members: updatedMembers,
            currentMembers: updatedMembers.length,
          } as any);
          console.log(`✅ Grupo "${data.groupName}" actualizado en BD`);
        }
      } catch (error) {
        console.error(`❌ Error al actualizar grupo en BD:`, error);
      }

      this.broadcastGroupList();
    }
  }

  @SubscribeMessage('leaveGroup')
  async handleLeaveGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupName: string; from: string },
  ) {
    console.log(
      `➖ WS: leaveGroup - Usuario: ${data.from}, Grupo: ${data.groupName}`,
    );
    const groupToLeave = this.groups.get(data.groupName);
    if (groupToLeave) {
      groupToLeave.delete(data.from || 'Usuario');

      // 🔥 NUEVO: Sincronizar cambios en BD
      try {
        const room = await this.temporaryRoomsService.findByName(
          data.groupName,
        );
        if (room) {
          const updatedMembers = Array.from(groupToLeave);
          await this.temporaryRoomsService.updateRoomMembers(room.id, {
            members: updatedMembers,
            currentMembers: updatedMembers.length,
          } as any);
          console.log(`✅ Grupo "${data.groupName}" actualizado en BD`);
        }
      } catch (error) {
        console.error(`❌ Error al actualizar grupo en BD:`, error);
      }

      this.broadcastGroupList();
    }
  }

  @SubscribeMessage('createTemporaryLink')
  handleCreateTemporaryLink(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      linkType: string;
      participants: string[];
      roomName?: string;
      from: string;
    },
  ) {
    console.log(
      `🔗 WS: createTemporaryLink - Tipo: ${data.linkType}, De: ${data.from}`,
    );
    const linkId = this.generateTemporaryLink(
      data.linkType,
      data.participants,
      data.from,
    );
    //const linkUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/#/join/${linkId}`;
    const linkUrl = `${process.env.FRONTEND_URL || 'https://chat.mass34.com'}/#/join/${linkId}`;

    client.emit('temporaryLinkCreated', {
      linkId,
      linkUrl,
      expiresAt: this.temporaryLinks.get(linkId).expiresAt.toISOString(),
      linkType: data.linkType,
      participants: data.participants || [],
      roomName: data.roomName || null,
    });
  }

  @SubscribeMessage('joinTemporaryLink')
  handleJoinTemporaryLink(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { linkId: string; from: string },
  ) {
    const { linkId, from } = data;
    const link = this.temporaryLinks.get(linkId);

    if (link && link.isActive && link.expiresAt > getPeruDate()) {
      if (link.type === 'conversation') {
        const groupName = `Conversación Temporal ${linkId.substring(0, 8)}`;
        const tempGroup = new Set<string>(
          (link.participants || []) as string[],
        );
        tempGroup.add(from || 'Usuario');
        this.groups.set(groupName, tempGroup);

        client.emit('joinedTemporaryConversation', {
          groupName,
          expiresAt: link.expiresAt.toISOString(),
          participants: Array.from(tempGroup),
        });

        this.broadcastGroupList();
      } else if (link.type === 'room') {
        client.emit('joinedTemporaryRoom', {
          roomName: link.roomName || 'Sala Temporal',
          expiresAt: link.expiresAt.toISOString(),
        });
      }
    } else {
      client.emit('error', {
        message: 'Enlace temporal no válido o expirado',
      });
    }
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      roomCode: string;
      roomName: string;
      from: string;
      isMonitoring?: boolean;
    },
  ) {
    console.log(
      `🏠 WS: joinRoom - Usuario: ${data.from}, Sala: ${data.roomCode}, Monitoreo: ${data.isMonitoring || false}`,
    );

    // 🔥 Si es monitoreo (ADMIN/JEFEPISO), NO actualizar BD, solo memoria
    if (!data.isMonitoring) {
      try {
        // 🔥 Actualizar la base de datos usando el servicio
        const joinDto = { roomCode: data.roomCode, username: data.from };
        await this.temporaryRoomsService.joinRoom(joinDto, data.from);
        // console.log(`✅ Usuario ${data.from} unido a sala en BD`);
      } catch (error) {
        // 🔥 NUEVO: Notificar al cliente del error
        console.error(
          `❌ Error al unir usuario ${data.from} a sala en BD:`,
          error,
        );
        client.emit('joinRoomError', {
          roomCode: data.roomCode,
          message: error.message || 'Error al unirse a la sala',
        });
        return; // No continuar si falla en BD
      }
    } else {
      console.log(
        `👁️ Usuario ${data.from} uniéndose como MONITOR (solo en memoria)`,
      );
    }

    // Agregar usuario a la sala en memoria
    if (!this.roomUsers.has(data.roomCode)) {
      this.roomUsers.set(data.roomCode, new Set());
    }
    this.roomUsers.get(data.roomCode)!.add(data.from);
    // console.log(`✅ Usuario ${data.from} agregado a sala en memoria`);

    // Actualizar la sala actual del usuario
    const user = this.users.get(data.from);
    if (user) {
      user.currentRoom = data.roomCode;
      // console.log(`✅ Sala actual del usuario actualizada a ${data.roomCode}`);
    }

    // Notificar a todos en la sala
    await this.broadcastRoomUsers(data.roomCode);

    // Obtener TODOS los usuarios añadidos a la sala para roomJoined
    const connectedUsernamesList = Array.from(
      this.roomUsers.get(data.roomCode) || [],
    );
    let allUsernames: string[] = [];
    try {
      const room = await this.temporaryRoomsService.findByRoomCode(
        data.roomCode,
      );
      // 🔥 MODIFICADO: Usar TODOS los usuarios añadidos (members)
      allUsernames = room.members || [];
    } catch (error) {
      console.error(`❌ Error al obtener sala ${data.roomCode}:`, error);
      allUsernames = connectedUsernamesList;
    }

    // Crear lista con TODOS los usuarios añadidos a la sala y su estado de conexión
    const roomUsersList = allUsernames.map((username) => {
      const user = this.users.get(username);
      // 🔥 CORREGIDO: Determinar isOnline basándose en si el usuario está conectado globalmente
      const isOnline = this.users.has(username) && user?.socket?.connected;
      return {
        id: user?.userData?.id || null,
        username: username,
        picture: user?.userData?.picture || null,
        nombre: user?.userData?.nombre || null,
        apellido: user?.userData?.apellido || null,
        sede: user?.userData?.sede || null,
        sede_id: user?.userData?.sede_id || null,
        isOnline: isOnline,
      };
    });

    // Confirmar al usuario que se unió
    client.emit('roomJoined', {
      roomCode: data.roomCode,
      roomName: data.roomName,
      users: roomUsersList,
    });
    console.log(`✅ Confirmación de unión enviada a ${data.from}`);

    // 🔥 NUEVO: Resetear contador de mensajes no leídos para este usuario en esta sala
    if (!data.isMonitoring) {
      this.emitUnreadCountReset(data.roomCode, data.from);
    }
  }

  @SubscribeMessage('kickUser')
  async handleKickUser(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { roomCode: string; username: string; kickedBy: string },
  ) {
    console.log(
      `👢 WS: kickUser - Usuario: ${data.username}, Sala: ${data.roomCode}, Expulsado por: ${data.kickedBy}`,
    );

    // Verificar que quien expulsa sea admin
    const kickerUser = this.users.get(data.kickedBy);
    if (!kickerUser || !kickerUser.userData) {
      console.log('❌ Usuario que intenta expulsar no encontrado');
      return;
    }

    const kickerRole = kickerUser.userData.role
      ?.toString()
      .toUpperCase()
      .trim();
    if (kickerRole !== 'ADMIN' && kickerRole !== 'JEFEPISO') {
      console.log('❌ Usuario no tiene permisos para expulsar');
      return;
    }

    try {
      // Remover usuario de la base de datos
      await this.temporaryRoomsService.leaveRoom(data.roomCode, data.username);
    } catch (error) {
      console.error('❌ Error al remover usuario de BD:', error);
    }

    // Remover usuario de la sala en memoria
    const roomUsersSet = this.roomUsers.get(data.roomCode);
    if (roomUsersSet) {
      roomUsersSet.delete(data.username);
    }

    // Notificar al usuario expulsado
    const kickedUser = this.users.get(data.username);
    if (kickedUser && kickedUser.socket) {
      kickedUser.socket.emit('kicked', {
        roomCode: data.roomCode,
        message: `Has sido expulsado de la sala por ${data.kickedBy}`,
      });
    }

    // Actualizar lista de usuarios en la sala usando broadcastRoomUsers
    await this.broadcastRoomUsers(data.roomCode);

    console.log(
      `✅ Usuario ${data.username} expulsado de la sala ${data.roomCode}`,
    );
  }

  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomCode: string; from: string },
  ) {
    console.log(
      `🚪 WS: leaveRoom - Usuario: ${data.from}, Sala: ${data.roomCode}`,
    );

    try {
      // Remover usuario de la base de datos
      await this.temporaryRoomsService.leaveRoom(data.roomCode, data.from);
    } catch (error) {
      // Error al remover de BD
    }

    // Remover usuario de la sala en memoria
    const roomUsersSet = this.roomUsers.get(data.roomCode);
    if (roomUsersSet) {
      roomUsersSet.delete(data.from);
      if (roomUsersSet.size === 0) {
        this.roomUsers.delete(data.roomCode);
      }
    }

    // Limpiar sala actual del usuario
    const user = this.users.get(data.from);
    if (user) {
      user.currentRoom = undefined;
    }

    // Notificar a todos en la sala
    await this.broadcastRoomUsers(data.roomCode);

    // Reenviar lista general de usuarios (ya que salió de la sala)
    this.broadcastUserList();
  }

  // ===== MÉTODOS PRIVADOS DEL CHAT =====

  private getRoomCodeFromUser(username: string): string | null {
    const user = this.users.get(username);
    return user?.currentRoom || null;
  }

  private generateTemporaryLink(
    type: string,
    participants: string[],
    createdBy: string,
  ): string {
    const linkId = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos

    this.temporaryLinks.set(linkId, {
      type,
      participants,
      expiresAt,
      createdBy,
      isActive: true,
      createdAt: getPeruDate(),
    });

    return linkId;
  }

  private cleanExpiredLinks() {
    const now = getPeruDate();
    for (const [linkId, link] of this.temporaryLinks.entries()) {
      if (link.expiresAt < now) {
        this.temporaryLinks.delete(linkId);
      }
    }
  }

  private async broadcastUserList(assignedConversations?: any[]) {
    // Crear lista de usuarios conectados con toda su información
    const connectedUsersMap = new Map<string, any>();
    const userListWithData = Array.from(this.users.entries()).map(
      ([username, { userData }]) => {
        const userInfo = {
          id: userData?.id || null,
          username: username,
          nombre: userData?.nombre || null,
          apellido: userData?.apellido || null,
          email: userData?.email || null,
          role: userData?.role || 'USER',
          picture: userData?.picture || null,
          sede: userData?.sede || null,
          sede_id: userData?.sede_id || null,
          numeroAgente: userData?.numeroAgente || null,
          isOnline: true, // Usuario conectado
        };
        connectedUsersMap.set(username, userInfo);
        return userInfo;
      },
    );

    // console.log('📋 Enviando lista de usuarios con datos completos:', userListWithData);

    console.log(
      `🔄 broadcastUserList - Total usuarios conectados: ${this.users.size}`,
    );

    // Procesar cada usuario conectado
    for (const [
      _username,
      { socket, userData, currentRoom },
    ] of this.users.entries()) {
      console.log(
        `  👤 Procesando usuario: ${userData?.username || 'Unknown'}, socket conectado: ${socket.connected}`,
      );

      if (socket.connected) {
        // 🔥 COMENTADO: Ahora enviamos la lista incluso si el usuario está en una sala
        // para que reciban actualizaciones de estado online/offline en tiempo real
        // if (currentRoom) {
        //   console.log(
        //     `🚫 Usuario ${userData?.username || 'Usuario'} está en sala ${currentRoom}, no enviar lista general`,
        //   );
        //   continue;
        // }

        // Solo enviar lista completa a usuarios admin
        const isAdmin =
          userData?.role &&
          userData.role.toString().toUpperCase().trim() === 'ADMIN';

        console.log(
          `    ℹ️ Usuario ${userData?.username} es admin: ${isAdmin}`,
        );

        if (isAdmin) {
          // 🔥 ADMIN: Enviar usuarios conectados + usuarios de conversaciones (offline)
          // Esto asegura que vean cambios de estado en tiempo real
          const adminUsersToSend = [...userListWithData]; // Usuarios conectados

          // Agregar usuarios offline de conversaciones
          if (assignedConversations && assignedConversations.length > 0) {
            const allParticipants = new Set<string>();
            assignedConversations.forEach((conv) => {
              conv.participants?.forEach((p) => allParticipants.add(p));
            });

            // Para cada participante, verificar si ya está en la lista
            for (const participantName of allParticipants) {
              if (
                !adminUsersToSend.some((u) => u.username === participantName)
              ) {
                // Buscar en BD para obtener datos completos
                try {
                  const dbUser = await this.userRepository
                    .createQueryBuilder('user')
                    .where(
                      'CONCAT(user.nombre, " ", user.apellido) = :fullName',
                      { fullName: participantName },
                    )
                    .orWhere('user.username = :username', {
                      username: participantName,
                    })
                    .getOne();

                  if (dbUser) {
                    const fullName =
                      dbUser.nombre && dbUser.apellido
                        ? `${dbUser.nombre} ${dbUser.apellido}`
                        : dbUser.username;

                    const isUserConnected =
                      this.users.has(fullName) ||
                      this.users.has(dbUser.username);

                    adminUsersToSend.push({
                      id: dbUser.id || null,
                      username: fullName,
                      nombre: dbUser.nombre || null,
                      apellido: dbUser.apellido || null,
                      email: dbUser.email || null,
                      role: dbUser.role || 'USER',
                      picture: null,
                      sede: null,
                      sede_id: null,
                      numeroAgente: dbUser.numeroAgente || null,
                      isOnline: isUserConnected, // offline
                    });
                  }
                } catch (error) {
                  console.error(
                    `❌ Error al buscar usuario ${participantName} en BD:`,
                    error,
                  );
                }
              }
            }
          }

          console.log(
            `    👑 ADMIN: Enviando ${adminUsersToSend.length} usuarios (${userListWithData.length} online + ${adminUsersToSend.length - userListWithData.length} offline)`,
          );

          // Enviar todos los usuarios (paginado)
          const pageSize = 50; // Aumentar tamaño de página para admins
          const firstPage = adminUsersToSend.slice(0, pageSize);
          socket.emit('userList', {
            users: firstPage,
            page: 0,
            pageSize: pageSize,
            totalUsers: adminUsersToSend.length,
            hasMore: adminUsersToSend.length > pageSize,
          });
        } else {
          console.log(
            `    👤 Procesando usuario NO ADMIN: ${userData?.username}`,
          );

          // Para usuarios no admin, incluir su propia información + usuarios de conversaciones asignadas
          const usersToSend = [];

          // Agregar información del usuario actual
          const ownUserData = connectedUsersMap.get(userData?.username);
          if (ownUserData) {
            usersToSend.push(ownUserData);
          }

          console.log(
            `    📝 Usuario actual agregado: ${ownUserData?.username || 'none'}`,
          );

          // 🔥 CORREGIDO: Obtener conversaciones del usuario actual
          // IMPORTANTE: Las conversaciones guardan participantes con NOMBRE COMPLETO, no username
          let userConversations = [];
          if (assignedConversations && assignedConversations.length > 0) {
            // Calcular nombre completo del usuario actual
            const currentUserFullName =
              userData?.nombre && userData?.apellido
                ? `${userData.nombre} ${userData.apellido}`
                : userData?.username;

            // Filtrar conversaciones donde este usuario es participante (por nombre completo)
            userConversations = assignedConversations.filter((conv) =>
              conv.participants?.includes(currentUserFullName),
            );

            console.log(
              `📋 Usuario ${currentUserFullName} tiene ${userConversations.length} conversaciones asignadas`,
            );
          } else {
            // Buscar en BD si no se pasaron conversaciones
            try {
              userConversations =
                await this.temporaryConversationsService.findAll(
                  userData?.username,
                );
            } catch (error) {
              console.error(
                `❌ Error al obtener conversaciones de ${userData?.username}:`,
                error,
              );
              userConversations = [];
            }
          }

          // Si tiene conversaciones asignadas, agregar información de los otros usuarios
          if (userConversations && userConversations.length > 0) {
            // Calcular nombre completo del usuario actual (de nuevo, para usarlo en comparaciones)
            const currentUserFullName =
              userData?.nombre && userData?.apellido
                ? `${userData.nombre} ${userData.apellido}`
                : userData?.username;

            for (const conv of userConversations) {
              if (conv.participants && Array.isArray(conv.participants)) {
                for (const participantName of conv.participants) {
                  // No agregar al usuario actual (comparar por nombre completo)
                  if (participantName !== currentUserFullName) {
                    // Verificar si ya está en la lista
                    if (
                      usersToSend.some((u) => u.username === participantName)
                    ) {
                      continue;
                    }

                    // Primero buscar en usuarios conectados
                    const participantData =
                      connectedUsersMap.get(participantName);

                    if (participantData) {
                      // Usuario está conectado
                      usersToSend.push(participantData);
                    } else {
                      // Usuario NO está conectado, buscar en la base de datos
                      try {
                        // Buscar por nombre completo (participantName puede ser "Nombre Apellido")
                        const dbUser = await this.userRepository
                          .createQueryBuilder('user')
                          .where(
                            'CONCAT(user.nombre, " ", user.apellido) = :fullName',
                            { fullName: participantName },
                          )
                          .orWhere('user.username = :username', {
                            username: participantName,
                          })
                          .getOne();

                        if (dbUser) {
                          const fullName =
                            dbUser.nombre && dbUser.apellido
                              ? `${dbUser.nombre} ${dbUser.apellido}`
                              : dbUser.username;

                          // 🔥 CORREGIDO: Verificar si el usuario está conectado
                          const isUserConnected =
                            this.users.has(fullName) ||
                            this.users.has(dbUser.username);

                          // Agregar usuario de la BD con estado de conexión correcto
                          usersToSend.push({
                            id: dbUser.id || null,
                            username: fullName,
                            nombre: dbUser.nombre || null,
                            apellido: dbUser.apellido || null,
                            email: dbUser.email || null,
                            role: dbUser.role || 'USER', // 🔥 Obtener role de la BD
                            picture: null, // No tenemos picture en la entidad User de chat
                            sede: null,
                            sede_id: null,
                            numeroAgente: dbUser.numeroAgente || null, // 🔥 Obtener numeroAgente de la BD
                            isOnline: isUserConnected, // 🔥 CORREGIDO: Estado de conexión real
                          });
                        }
                      } catch (error) {
                        console.error(
                          `❌ Error al buscar usuario ${participantName} en BD:`,
                          error,
                        );
                      }
                    }
                  }
                }
              }
            }
          }

          // console.log(`👤 Enviando información a usuario: ${userData?.username}`, usersToSend);
          socket.emit('userList', { users: usersToSend });
        }
      }
    }
  }

  private broadcastGroupList() {
    const groupList = Array.from(this.groups.entries()).map(
      ([name, members]) => ({
        name,
        members: Array.from(members),
      }),
    );

    this.users.forEach(({ socket }) => {
      if (socket.connected) {
        socket.emit('groupList', { groups: groupList });
      }
    });
  }

  private async broadcastRoomUsers(roomCode: string) {
    const connectedUsernamesList = Array.from(
      this.roomUsers.get(roomCode) || [],
    );

    // Obtener TODOS los usuarios añadidos a la sala (historial)
    let allUsernames: string[] = [];
    let memberCount: number = 0;
    try {
      const room = await this.temporaryRoomsService.findByRoomCode(roomCode);
      // 🔥 MODIFICADO: Usar TODOS los usuarios añadidos (members) para mostrar en la lista
      allUsernames = room.members || [];
      // 🔥 El contador debe ser el total de usuarios añadidos a la sala
      memberCount = room.members?.length || 0;
    } catch (error) {
      // Si hay error, usar solo los usuarios conectados
      allUsernames = connectedUsernamesList;
      memberCount = connectedUsernamesList.length;
    }

    // Crear lista con TODOS los usuarios añadidos a la sala y su estado de conexión
    const roomUsersList = allUsernames.map((username) => {
      const user = this.users.get(username);
      // 🔥 CORREGIDO: Determinar isOnline basándose en si el usuario está conectado globalmente
      const isOnline = this.users.has(username) && user?.socket?.connected;
      return {
        id: user?.userData?.id || null,
        username: username,
        picture: user?.userData?.picture || null,
        nombre: user?.userData?.nombre || null,
        apellido: user?.userData?.apellido || null,
        sede: user?.userData?.sede || null,
        sede_id: user?.userData?.sede_id || null,
        role: user?.userData?.role || null,
        numeroAgente: user?.userData?.numeroAgente || null,
        isOnline: isOnline,
      };
    });

    // Enviar a TODOS los usuarios conectados (para que vean actualizaciones en tiempo real)
    // Esto permite que usuarios que salieron de la sala vean cuando otros entran/salen
    this.users.forEach(({ socket }) => {
      if (socket.connected) {
        socket.emit('roomUsers', {
          roomCode,
          users: roomUsersList,
        });
      }
    });

    // 🔥 MODIFICADO: Usar members.length para el contador (total de usuarios añadidos a la sala)
    // Notificar a todos los ADMIN y JEFEPISO sobre el cambio en el contador de usuarios
    this.broadcastRoomCountUpdate(roomCode, memberCount);
  }

  private broadcastRoomCountUpdate(roomCode: string, currentMembers: number) {
    // Enviar actualización del contador a todos los ADMIN y JEFEPISO
    this.users.forEach(({ socket, userData }) => {
      const role = userData?.role?.toString().toUpperCase().trim();
      if (socket.connected && (role === 'ADMIN' || role === 'JEFEPISO')) {
        socket.emit('roomCountUpdate', {
          roomCode,
          currentMembers,
        });
      }
    });
  }

  // ==================== EVENTOS WEBRTC (SIMPLE-PEER) ====================

  @SubscribeMessage('callUser')
  handleCallUser(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      userToCall: string;
      signalData: any;
      from: string;
      callType: string;
    },
  ) {
    console.log(
      `📞 WS: callUser - De: ${data.from}, Para: ${data.userToCall}, Tipo: ${data.callType}`,
    );

    const targetUser = this.users.get(data.userToCall);
    if (targetUser && targetUser.socket.connected) {
      targetUser.socket.emit('callUser', {
        signal: data.signalData,
        from: data.from,
        callType: data.callType,
      });
    } else {
      client.emit('callFailed', { reason: 'Usuario no disponible' });
    }
  }

  @SubscribeMessage('answerCall')
  handleAnswerCall(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { signal: any; to: string },
  ) {
    console.log(`📞 WS: answerCall - Para: ${data.to}`);

    const targetUser = this.users.get(data.to);
    if (targetUser && targetUser.socket.connected) {
      targetUser.socket.emit('callAccepted', {
        signal: data.signal,
      });
    }
  }

  @SubscribeMessage('callRejected')
  handleCallRejected(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { to: string; from: string },
  ) {
    console.log(`❌ WS: callRejected - De: ${data.from}`);

    const targetUser = this.users.get(data.to);
    if (targetUser && targetUser.socket.connected) {
      targetUser.socket.emit('callRejected', {
        from: data.from,
      });
    }
  }

  // 🔥 NUEVO: Manejar candidatos ICE para trickling
  @SubscribeMessage('iceCandidate')
  handleIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { candidate: any; to: string },
  ) {
    console.log(`🧊 WS: iceCandidate - Para: ${data.to}`);

    const targetUser = this.users.get(data.to);
    if (targetUser && targetUser.socket.connected) {
      targetUser.socket.emit('iceCandidate', {
        candidate: data.candidate,
      });
    }
  }

  @SubscribeMessage('callEnded')
  handleCallEnded(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { to: string },
  ) {
    console.log(`📴 WS: callEnded - Para: ${data.to}`);

    const targetUser = this.users.get(data.to);
    if (targetUser && targetUser.socket.connected) {
      targetUser.socket.emit('callEnded');
    }
  }

  // ==================== VIDEOLLAMADAS (ZEGOCLOUD) ====================

  @SubscribeMessage('joinVideoRoom')
  handleJoinVideoRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomID: string; username: string },
  ) {
    console.log(
      `📹 WS: joinVideoRoom - Usuario: ${data.username} uniéndose a sala de video: ${data.roomID}`,
    );

    // Unir el socket a la sala de video
    client.join(data.roomID);

    console.log(
      `✅ Usuario ${data.username} unido a sala de video ${data.roomID}`,
    );
  }

  @SubscribeMessage('startVideoCall')
  handleStartVideoCall(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      roomID: string;
      callType: string;
      chatId: string;
      initiator: string;
      callUrl: string;
      participants: string[];
    },
  ) {
    console.log(
      `📹 WS: startVideoCall - Iniciador: ${data.initiator}, Tipo: ${data.callType}, Sala: ${data.roomID}`,
    );

    // Notificar a todos los participantes
    if (data.callType === 'group' && data.participants) {
      // Videollamada grupal
      data.participants.forEach((participant) => {
        const targetUser = this.users.get(participant);
        if (targetUser && targetUser.socket.connected) {
          targetUser.socket.emit('incomingVideoCall', {
            roomID: data.roomID,
            initiator: data.initiator,
            callUrl: data.callUrl,
            callType: 'group',
          });
        }
      });
    } else if (data.callType === 'individual' && data.participants[0]) {
      // Videollamada individual
      const targetUser = this.users.get(data.participants[0]);
      if (targetUser && targetUser.socket.connected) {
        targetUser.socket.emit('incomingVideoCall', {
          roomID: data.roomID,
          initiator: data.initiator,
          callUrl: data.callUrl,
          callType: 'individual',
        });
      }
    }
  }

  @SubscribeMessage('endVideoCall')
  async handleEndVideoCall(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      roomID: string;
      roomCode?: string;
      participants?: string[];
      closedBy: string;
      isGroup?: boolean;
    },
  ) {
    // console.log(
    //   `📴 WS: endVideoCall - Sala: ${data.roomID}, RoomCode: ${data.roomCode}, Cerrada por: ${data.closedBy}`,
    // );

    // 🔥 NUEVO: Marcar la videollamada como inactiva en la BD
    try {
      // Buscar el mensaje de videollamada por videoRoomID usando el servicio
      let videoCallMessage = await this.messagesService.findByVideoRoomID(
        data.roomID,
      );

      // 🔥 FALLBACK: Mensajes antiguos sin videoRoomID (solo tienen URL y roomCode)
      if (!videoCallMessage && data.roomCode) {
        videoCallMessage =
          await this.messagesService.findLatestVideoCallByRoomCode(
            data.roomCode,
          );
        // if (videoCallMessage) {
        //   console.log(
        //     `⚠️ Videollamada encontrada por roomCode (sin videoRoomID): ${videoCallMessage.id}`,
        //   );
        // }
      }

      if (videoCallMessage) {
        // Actualizar metadata para marcar como inactiva
        const metadata = videoCallMessage.metadata || {};
        metadata.isActive = false;
        metadata.closedBy = data.closedBy;
        metadata.closedAt = new Date().toISOString();

        const updatePayload: any = {
          metadata,
        };

        // 🔥 Si el mensaje no tenía videoRoomID, guardarlo ahora para futuras búsquedas
        if (!videoCallMessage.videoRoomID && data.roomID) {
          updatePayload.videoRoomID = data.roomID;
        }

        await this.messagesService.update(videoCallMessage.id, updatePayload);

        // console.log(
        //   `✅ Videollamada marcada como inactiva en BD: ${videoCallMessage.id}`,
        // );
      } else {
        // console.warn(
        //   `⚠️ No se encontró mensaje de videollamada para roomID=${data.roomID} / roomCode=${data.roomCode}`,
        // );
      }
    } catch (error) {
      console.error('❌ Error al marcar videollamada como inactiva:', error);
    }

    // 🔥 CRÍTICO: Obtener TODOS los miembros del grupo desde la BD
    let groupMembers: string[] = [];

    if (data.roomCode) {
      try {
        // 🔥 PRIMERO: Buscar en la base de datos para obtener TODOS los miembros
        const room = await this.temporaryRoomsService.findByRoomCode(
          data.roomCode,
        );
        if (room && room.members && room.members.length > 0) {
          groupMembers = room.members;
          console.log(
            `👥 Miembros de la sala ${data.roomCode} desde BD:`,
            groupMembers,
          );
        } else {
          console.warn(
            `⚠️ No se encontraron miembros en BD para sala ${data.roomCode}`,
          );
        }
      } catch (error) {
        console.error(
          `❌ Error al obtener sala ${data.roomCode} desde BD:`,
          error,
        );
      }

      // 🔥 FALLBACK: Si no se encontraron miembros en BD, intentar desde memoria
      if (groupMembers.length === 0) {
        const roomUsersSet = this.roomUsers.get(data.roomCode);
        if (roomUsersSet && roomUsersSet.size > 0) {
          groupMembers = Array.from(roomUsersSet);
          console.log(
            `👥 Miembros activos en sala ${data.roomCode} desde memoria:`,
            groupMembers,
          );
        }
      }
    }

    // Notificar a todos los miembros del grupo
    if (groupMembers.length > 0) {
      console.log(
        `📢 Notificando cierre de videollamada a ${groupMembers.length} miembros`,
      );
      groupMembers.forEach((member) => {
        const targetUser = this.users.get(member);
        if (targetUser && targetUser.socket.connected) {
          console.log(`   ✅ Notificando a: ${member}`);
          targetUser.socket.emit('videoCallEnded', {
            roomID: data.roomID,
            roomCode: data.roomCode,
            closedBy: data.closedBy,
            message: `La videollamada fue cerrada por ${data.closedBy}`,
          });
        } else {
          console.log(`   ❌ Usuario no conectado: ${member}`);
        }
      });
    }

    // 🔥 NUEVO: Si es grupo, emitir a toda la sala por roomCode (por si acaso)
    if (data.isGroup && data.roomCode) {
      console.log(`📡 Emitiendo a sala ${data.roomCode} via broadcast`);
      this.server.to(data.roomCode).emit('videoCallEnded', {
        roomID: data.roomID,
        roomCode: data.roomCode,
        closedBy: data.closedBy,
        message: `La videollamada fue cerrada por ${data.closedBy}`,
      });
    }

    // También emitir a toda la sala de video por si acaso
    console.log(`📡 Emitiendo a sala de video ${data.roomID} via broadcast`);
    this.server.to(data.roomID).emit('videoCallEnded', {
      roomID: data.roomID,
      roomCode: data.roomCode,
      closedBy: data.closedBy,
      message: `La videollamada fue cerrada por ${data.closedBy}`,
    });
  }

  // ==================== MENSAJES LEÍDOS ====================

  @SubscribeMessage('markAsRead')
  async handleMarkAsRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: number; username: string; from: string },
  ) {
    console.log(
      `✅ WS: markAsRead - Mensaje ${data.messageId} leído por ${data.username}`,
    );

    try {
      // Marcar el mensaje como leído en la base de datos
      const message = await this.messagesService.markAsRead(
        data.messageId,
        data.username,
      );

      if (message) {
        // Notificar al remitente que su mensaje fue leído
        const senderUser = this.users.get(data.from);
        if (senderUser && senderUser.socket.connected) {
          senderUser.socket.emit('messageRead', {
            messageId: data.messageId,
            readBy: data.username,
            readAt: message.readAt,
          });
        }

        // Confirmar al lector
        client.emit('messageReadConfirmed', {
          messageId: data.messageId,
          readAt: message.readAt,
        });
      }
    } catch (error) {
      console.error('Error al marcar mensaje como leído:', error);
      client.emit('error', { message: 'Error al marcar mensaje como leído' });
    }
  }

  @SubscribeMessage('markConversationAsRead')
  async handleMarkConversationAsRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { from: string; to: string },
  ) {
    console.log(
      `✅ WS: markConversationAsRead - Conversación de ${data.from} a ${data.to} marcada como leída`,
    );

    try {
      // Marcar todos los mensajes de la conversación como leídos
      const messages = await this.messagesService.markConversationAsRead(
        data.from,
        data.to,
      );

      if (messages.length > 0) {
        // 🔥 Búsqueda case-insensitive del remitente
        let senderUser = this.users.get(data.from);

        if (!senderUser) {
          const senderNormalized = data.from?.toLowerCase().trim();
          const foundUsername = Array.from(this.users.keys()).find(
            (key) => key?.toLowerCase().trim() === senderNormalized,
          );
          if (foundUsername) {
            senderUser = this.users.get(foundUsername);
            console.log(
              `✅ Remitente encontrado con búsqueda case-insensitive: ${foundUsername}`,
            );
          }
        }

        // Notificar al remitente que sus mensajes fueron leídos
        if (senderUser && senderUser.socket.connected) {
          console.log(
            `📨 Notificando a ${data.from} que sus mensajes fueron leídos por ${data.to}`,
          );
          senderUser.socket.emit('conversationRead', {
            readBy: data.to,
            messageIds: messages.map((m) => m.id),
            readAt: getPeruDate(),
          });
        } else {
          console.log(
            `❌ No se pudo notificar a ${data.from} (usuario no conectado o no encontrado)`,
          );
        }

        // Confirmar al lector
        client.emit('conversationReadConfirmed', {
          messagesUpdated: messages.length,
          readAt: getPeruDate(),
        });
      }
    } catch (error) {
      console.error('Error al marcar conversación como leída:', error);
      client.emit('error', {
        message: 'Error al marcar conversación como leída',
      });
    }
  }

  @SubscribeMessage('markRoomMessageAsRead')
  async handleMarkRoomMessageAsRead(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { messageId: number; username: string; roomCode: string },
  ) {
    console.log(
      `✅ WS: markRoomMessageAsRead - Mensaje ${data.messageId} en sala ${data.roomCode} leído por ${data.username}`,
    );

    try {
      // Marcar el mensaje como leído en la base de datos
      const message = await this.messagesService.markAsRead(
        data.messageId,
        data.username,
      );

      if (message) {
        // Notificar a todos los usuarios de la sala que el mensaje fue leído
        const roomUsers = this.roomUsers.get(data.roomCode);
        if (roomUsers) {
          roomUsers.forEach((member) => {
            const memberUser = this.users.get(member);
            if (memberUser && memberUser.socket.connected) {
              memberUser.socket.emit('roomMessageRead', {
                messageId: data.messageId,
                readBy: message.readBy, // Enviar el array completo de lectores
                readAt: message.readAt,
                roomCode: data.roomCode,
              });
            }
          });
        }
      }
    } catch (error) {
      console.error('Error al marcar mensaje de sala como leído:', error);
      client.emit('error', {
        message: 'Error al marcar mensaje de sala como leído',
      });
    }
  }

  @SubscribeMessage('markRoomMessagesAsRead')
  async handleMarkRoomMessagesAsRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomCode: string; username: string },
  ) {
    console.log(
      `✅ WS: markRoomMessagesAsRead - Sala ${data.roomCode} leída por ${data.username}`,
    );

    try {
      // Marcar todos los mensajes de la sala como leídos en la base de datos
      const updatedCount = await this.messagesService.markAllMessagesAsReadInRoom(
        data.roomCode,
        data.username,
      );

      console.log(
        `✅ ${updatedCount} mensajes marcados como leídos en sala ${data.roomCode}`,
      );

      // Confirmar al usuario que la acción fue exitosa
      client.emit('roomMessagesReadConfirmed', {
        roomCode: data.roomCode,
        updatedCount,
      });

      // 🔥 Emitir reset de contador para asegurar que el frontend se actualice
      this.emitUnreadCountReset(data.roomCode, data.username);

      // 🔥 También emitir actualización de contador a 0 explícitamente
      this.emitUnreadCountUpdateForUser(data.roomCode, data.username, 0);

    } catch (error) {
      console.error('Error al marcar mensajes de sala como leídos:', error);
      client.emit('error', {
        message: 'Error al marcar mensajes de sala como leídos',
      });
    }
  }

  @SubscribeMessage('threadMessage')
  async handleThreadMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    console.log(
      `🧵 WS: threadMessage - ThreadID: ${data.threadId}, De: ${data.from}, Para: ${data.to}`,
    );

    try {
      const { from, to, isGroup, roomCode } = data;

      if (isGroup && roomCode) {
        // Mensaje de hilo en grupo/sala - enviar a todos los miembros de la sala
        const roomUsers = this.roomUsers.get(roomCode);
        if (roomUsers) {
          roomUsers.forEach((member) => {
            const memberUser = this.users.get(member);
            if (memberUser && memberUser.socket.connected) {
              memberUser.socket.emit('threadMessage', data);
            }
          });
        }
      } else {
        // Mensaje de hilo en conversación 1-a-1
        // 🔥 Búsqueda case-insensitive del remitente
        let senderUser = this.users.get(from);
        if (!senderUser && from) {
          const fromNormalized = from.toLowerCase().trim();
          const foundUsername = Array.from(this.users.keys()).find(
            (key) => key?.toLowerCase().trim() === fromNormalized,
          );
          if (foundUsername) {
            senderUser = this.users.get(foundUsername);
            console.log(
              `✅ Remitente encontrado con búsqueda case-insensitive: ${foundUsername}`,
            );
          }
        }

        if (senderUser && senderUser.socket.connected) {
          senderUser.socket.emit('threadMessage', data);
        }

        // 🔥 Búsqueda case-insensitive del destinatario
        let recipientUser = this.users.get(to);
        if (!recipientUser && to) {
          const toNormalized = to.toLowerCase().trim();
          const foundUsername = Array.from(this.users.keys()).find(
            (key) => key?.toLowerCase().trim() === toNormalized,
          );
          if (foundUsername) {
            recipientUser = this.users.get(foundUsername);
            console.log(
              `✅ Destinatario encontrado con búsqueda case-insensitive: ${foundUsername}`,
            );
          }
        }

        if (recipientUser && recipientUser.socket.connected) {
          recipientUser.socket.emit('threadMessage', data);
        }
      }

      // console.log(`✅ Mensaje de hilo enviado correctamente`);
    } catch (error) {
      console.error('❌ Error al enviar mensaje de hilo:', error);
      client.emit('error', { message: 'Error al enviar mensaje de hilo' });
    }
  }

  @SubscribeMessage('threadCountUpdated')
  async handleThreadCountUpdated(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    // console.log(
    //   `🔢 WS: threadCountUpdated - MessageID: ${data.messageId}, LastReply: ${data.lastReplyFrom}, From: ${data.from}, To: ${data.to}`,
    // );

    try {
      const { messageId, lastReplyFrom, isGroup, roomCode, to, from } = data;

      // 🔥 Preparar el payload completo con toda la información necesaria
      const updatePayload = {
        messageId,
        lastReplyFrom,
        from,
        to,
        isGroup,
        roomCode,
      };

      if (isGroup && roomCode) {
        // Actualización en grupo/sala - enviar a todos los miembros de la sala
        const roomUsers = this.roomUsers.get(roomCode);
        if (roomUsers) {
          roomUsers.forEach((member) => {
            const memberUser = this.users.get(member);
            if (memberUser && memberUser.socket.connected) {
              memberUser.socket.emit('threadCountUpdated', updatePayload);
            }
          });
        }
      } else {
        // Actualización en conversación 1-a-1
        // 🔥 Búsqueda case-insensitive del destinatario
        let recipientUser = this.users.get(to);
        if (!recipientUser && to) {
          const toNormalized = to.toLowerCase().trim();
          const foundUsername = Array.from(this.users.keys()).find(
            (key) => key?.toLowerCase().trim() === toNormalized,
          );
          if (foundUsername) {
            recipientUser = this.users.get(foundUsername);
            console.log(
              `✅ Destinatario encontrado con búsqueda case-insensitive: ${foundUsername}`,
            );
          }
        }

        if (recipientUser && recipientUser.socket.connected) {
          // console.log(`✅ Enviando threadCountUpdated al destinatario: ${to}`);
          recipientUser.socket.emit('threadCountUpdated', updatePayload);
        } else {
          console.log(`⚠️ Destinatario no encontrado o no conectado: ${to}`);
        }

        // 🔥 Búsqueda case-insensitive del remitente
        let senderUser = this.users.get(from);
        if (!senderUser && from) {
          const fromNormalized = from.toLowerCase().trim();
          const foundUsername = Array.from(this.users.keys()).find(
            (key) => key?.toLowerCase().trim() === fromNormalized,
          );
          if (foundUsername) {
            senderUser = this.users.get(foundUsername);
            console.log(
              `✅ Remitente encontrado con búsqueda case-insensitive: ${foundUsername}`,
            );
          }
        }

        if (senderUser && senderUser.socket.connected && from !== to) {
          // console.log(`✅ Enviando threadCountUpdated al remitente: ${from}`);
          senderUser.socket.emit('threadCountUpdated', updatePayload);
        } else if (from === to) {
          // console.log(
          //   `ℹ️ Remitente y destinatario son el mismo usuario, no se envía duplicado`,
          // );
        } else {
          console.log(`⚠️ Remitente no encontrado o no conectado: ${from}`);
        }
      }

      // console.log(`✅ Contador de hilo actualizado correctamente`);
    } catch (error) {
      console.error('❌ Error al actualizar contador de hilo:', error);
      client.emit('error', { message: 'Error al actualizar contador de hilo' });
    }
  }

  // ==================== REACCIONES A MENSAJES ====================

  @SubscribeMessage('toggleReaction')
  async handleToggleReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      messageId: number;
      username: string;
      emoji: string;
      roomCode?: string;
      to?: string;
    },
  ) {
    console.log(
      `😊 WS: toggleReaction - Mensaje ${data.messageId}, Usuario: ${data.username}, Emoji: ${data.emoji}`,
    );
    console.log(
      `📍 toggleReaction - roomCode: ${data.roomCode}, to: ${data.to}`,
    );

    try {
      const message = await this.messagesService.toggleReaction(
        data.messageId,
        data.username,
        data.emoji,
      );

      if (message) {
        console.log(
          `✅ Reacción guardada, emitiendo evento reactionUpdated...`,
        );

        // Emitir la actualización a todos los usuarios relevantes
        if (data.roomCode) {
          console.log(
            `📢 Es mensaje de sala (${data.roomCode}), notificando a miembros...`,
          );
          const roomUsers = this.roomUsers.get(data.roomCode);
          console.log(
            `👥 Usuarios en sala:`,
            roomUsers ? Array.from(roomUsers) : 'No hay usuarios',
          );

          if (roomUsers) {
            let notifiedCount = 0;
            roomUsers.forEach((member) => {
              const memberUser = this.users.get(member);
              if (memberUser && memberUser.socket.connected) {
                memberUser.socket.emit('reactionUpdated', {
                  messageId: data.messageId,
                  reactions: message.reactions,
                  roomCode: data.roomCode,
                });
                notifiedCount++;
              }
            });
            console.log(
              `✅ Notificados ${notifiedCount} usuarios en sala ${data.roomCode}`,
            );
          } else {
            console.log(
              `⚠️ No se encontraron usuarios en la sala ${data.roomCode}`,
            );
          }
        } else if (data.to) {
          console.log(`📢 Es mensaje 1-a-1, notificando a ${data.to}...`);

          // Si es un mensaje 1-a-1, notificar al otro usuario
          const otherUser = this.users.get(data.to);
          if (otherUser && otherUser.socket.connected) {
            otherUser.socket.emit('reactionUpdated', {
              messageId: data.messageId,
              reactions: message.reactions,
              to: data.to,
            });
            console.log(`✅ Notificado usuario ${data.to}`);
          } else {
            console.log(`⚠️ Usuario ${data.to} no encontrado o desconectado`);
          }

          // También notificar al usuario que reaccionó
          client.emit('reactionUpdated', {
            messageId: data.messageId,
            reactions: message.reactions,
            to: data.to,
          });
          console.log(`✅ Notificado usuario que reaccionó (${data.username})`);
        } else {
          console.log(`⚠️ No hay roomCode ni to, no se puede notificar`);
        }
      } else {
        console.log(
          `❌ No se pudo guardar la reacción (mensaje no encontrado)`,
        );
      }
    } catch (error) {
      console.error('❌ Error al alternar reacción:', error);
      client.emit('error', { message: 'Error al alternar reacción' });
    }
  }

  // ==================== NOTIFICACIONES DE SALAS ====================

  /**
   * Notificar a todos los usuarios ADMIN y JEFEPISO que se creó una nueva sala
   */
  broadcastRoomCreated(room: any) {
    console.log(
      `✨ Broadcasting room created: ${room.roomCode} (ID: ${room.id})`,
    );

    // Enviar notificación a todos los ADMIN y JEFEPISO
    this.users.forEach(({ socket, userData }) => {
      const role = userData?.role?.toString().toUpperCase().trim();
      if (socket.connected && (role === 'ADMIN' || role === 'JEFEPISO')) {
        socket.emit('roomCreated', {
          id: room.id,
          name: room.name,
          roomCode: room.roomCode,
          maxCapacity: room.maxCapacity,
          currentMembers: room.currentMembers,
          createdAt: room.createdAt,
          isActive: room.isActive,
        });
      }
    });
  }

  /**
   * Notificar a todos los usuarios ADMIN y JEFEPISO que una sala fue eliminada/desactivada
   * También notifica a todos los miembros de la sala
   */
  broadcastRoomDeleted(roomCode: string, roomId: number) {
    console.log(`🗑️ Broadcasting room deleted: ${roomCode} (ID: ${roomId})`);

    // Enviar notificación a todos los ADMIN y JEFEPISO
    this.users.forEach(({ socket, userData }) => {
      const role = userData?.role?.toString().toUpperCase().trim();
      if (socket.connected && (role === 'ADMIN' || role === 'JEFEPISO')) {
        socket.emit('roomDeleted', {
          roomCode,
          roomId,
        });
      }
    });

    // 🔥 NUEVO: Notificar a todos los miembros de la sala que fue desactivada
    const roomMembers = this.roomUsers.get(roomCode);
    if (roomMembers) {
      console.log(
        `📢 Notificando a ${roomMembers.size} miembros de la sala ${roomCode}`,
      );

      roomMembers.forEach((username) => {
        const userConnection = this.users.get(username);
        if (userConnection && userConnection.socket.connected) {
          console.log(
            `✅ Notificando a ${username} que la sala fue desactivada`,
          );
          userConnection.socket.emit('roomDeactivated', {
            roomCode,
            roomId,
            message: 'La sala ha sido desactivada por el administrador',
          });
        }
      });

      // Limpiar el mapa de usuarios de la sala
      this.roomUsers.delete(roomCode);
    }
  }

  /**
   * Notificar a un usuario específico que fue agregado a una sala
   */
  notifyUserAddedToRoom(username: string, roomCode: string, roomName: string) {
    console.log(
      `➕ Notificando a ${username} que fue agregado a la sala ${roomCode}`,
    );

    const userConnection = this.users.get(username);
    if (userConnection && userConnection.socket.connected) {
      console.log(
        `✅ Usuario ${username} está conectado, enviando notificación`,
      );
      userConnection.socket.emit('addedToRoom', {
        roomCode,
        roomName,
        message: `Has sido agregado a la sala: ${roomName}`,
      });
    } else {
      console.log(
        `❌ Usuario ${username} NO está conectado o no existe en el mapa de usuarios`,
      );
      console.log(`📋 Usuarios conectados:`, Array.from(this.users.keys()));
    }
  }

  /**
   * Notificar cuando un usuario es eliminado de una sala
   */
  async handleUserRemovedFromRoom(roomCode: string, username: string) {
    console.log(`🚫 Usuario ${username} eliminado de la sala ${roomCode}`);

    // Remover el usuario del mapa de usuarios de la sala
    const roomUserSet = this.roomUsers.get(roomCode);
    if (roomUserSet) {
      roomUserSet.delete(username);
      if (roomUserSet.size === 0) {
        this.roomUsers.delete(roomCode);
      }
    }

    // Notificar al usuario eliminado
    const userConnection = this.users.get(username);
    if (userConnection && userConnection.socket.connected) {
      userConnection.socket.emit('removedFromRoom', {
        roomCode,
        message: 'Has sido eliminado de la sala',
      });

      // Limpiar la sala actual del usuario
      if (userConnection.userData) {
        userConnection.userData.currentRoom = undefined;
      }
    }

    // Notificar a todos los usuarios de la sala sobre la actualización
    await this.broadcastRoomUsers(roomCode);

    // Reenviar lista general de usuarios
    this.broadcastUserList();
  }


  /**
   * 🔥 NUEVO: Emitir evento de monitoreo a todos los ADMIN/JEFEPISO
   * Cuando se envía un mensaje entre dos usuarios, notificar a los monitores
   */
  private broadcastMonitoringMessage(messageData: any) {
    console.log(
      `📡 Broadcasting monitoringMessage a ADMIN/JEFEPISO - De: ${messageData.from}, Para: ${messageData.to}`,
    );

    this.users.forEach(({ socket, userData }) => {
      const role = userData?.role?.toString().toUpperCase().trim();
      if (socket.connected && (role === 'ADMIN' || role === 'JEFEPISO')) {
        socket.emit('monitoringMessage', messageData);
      }
    });
  }

  // 🔥 NUEVO: Emitir actualización de contador de mensajes no leídos para un usuario específico
  public emitUnreadCountUpdateForUser(
    roomCode: string,
    username: string,
    count: number,
    lastMessage?: {
      text: string;
      from: string;
      time: string;
      sentAt: string;
    },
  ) {
    // console.log(
    //   `📊 Emitiendo actualización de contador no leído - Sala: ${roomCode}, Usuario: ${username}, Conteo: ${count}`,
    // );
    // console.log(`📊 DEBUG - lastMessage:`, lastMessage);

    const userConnection = this.users.get(username);
    if (userConnection && userConnection.socket.connected) {
      const payload = {
        roomCode,
        count,
        lastMessage,
      };
      // console.log(`📊 DEBUG - Payload completo:`, payload);
      // console.log(`📊 DEBUG - Socket conectado: ${userConnection.socket.connected}`);
      // console.log(`📊 DEBUG - Socket ID: ${userConnection.socket.id}`);
      userConnection.socket.emit('unreadCountUpdate', payload);
      // console.log(`📊 DEBUG - Evento emitido exitosamente`);
    } else {
      // console.log(`❌ DEBUG - No se pudo emitir: userConnection=${!!userConnection}, connected=${userConnection?.socket?.connected}`);
    }
  }

  // 🔥 NUEVO: Emitir reset de contador cuando usuario entra a sala
  public emitUnreadCountReset(roomCode: string, username: string) {
    console.log(
      `📊 Emitiendo reset de contador no leído - Sala: ${roomCode}, Usuario: ${username}`,
    );

    const userConnection = this.users.get(username);
    if (userConnection && userConnection.socket.connected) {
      userConnection.socket.emit('unreadCountReset', {
        roomCode,
      });
    }
  }

  /**
   * 🔥 NUEVO: Método público para emitir evento de monitoreo desde el controller HTTP
   * Se usa cuando se crea un mensaje a través del endpoint POST /api/messages
   */
  public broadcastMonitoringMessagePublic(messageData: any) {
    console.log(
      `📡 Broadcasting monitoringMessage (PUBLIC) a ADMIN/JEFEPISO - De: ${messageData.from}, Para: ${messageData.to}`,
    );

    this.users.forEach(({ socket, userData }) => {
      const role = userData?.role?.toString().toUpperCase().trim();
      if (socket.connected && (role === 'ADMIN' || role === 'JEFEPISO')) {
        socket.emit('monitoringMessage', messageData);
      }
    });
  }

  // 🔥 NUEVO: Generar hash de mensaje para detección de duplicados
  private createMessageHash(data: any): string {
    const hashContent = `${data.from}-${data.to}-${data.message || ''}-${data.isGroup}`;
    return crypto.createHash('sha256').update(hashContent).digest('hex');
  }

  // 🔥 NUEVO: Limpiar caché de mensajes antiguos (más de 5 segundos)
  private cleanRecentMessagesCache() {
    const now = Date.now();
    const CACHE_EXPIRY = 5000; // 5 segundos

    for (const [hash, timestamp] of this.recentMessages.entries()) {
      if (now - timestamp > CACHE_EXPIRY) {
        this.recentMessages.delete(hash);
      }
    }
  }

  // 🔥 NUEVO: Verificar si un mensaje es duplicado
  private isDuplicateMessage(data: any): boolean {
    const messageHash = this.createMessageHash(data);
    const now = Date.now();
    const lastSent = this.recentMessages.get(messageHash);
    const DUPLICATE_WINDOW = 2000; // 2 segundos

    // Si el mismo mensaje se envió en los últimos 2 segundos, es duplicado
    if (lastSent && (now - lastSent) < DUPLICATE_WINDOW) {
      console.log('⚠️ Mensaje duplicado detectado en backend:', {
        hash: messageHash.substring(0, 8) + '...',
        timeSinceLastSend: now - lastSent,
        from: data.from,
        to: data.to,
      });
      return true;
    }

    // Registrar este mensaje
    this.recentMessages.set(messageHash, now);
    return false;
  }
}
