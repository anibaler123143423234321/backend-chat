import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { TemporaryRoomsService } from '../temporary-rooms/temporary-rooms.service';
import { MessagesService } from '../messages/messages.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  transports: ['websocket'],
})
@Injectable()
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
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

  constructor(
    private temporaryRoomsService: TemporaryRoomsService,
    private messagesService: MessagesService,
  ) {
    // Limpiar enlaces expirados cada 5 minutos
    setInterval(() => this.cleanExpiredLinks(), 5 * 60 * 1000);
  }

  handleDisconnect(client: Socket) {
    // console.log('Un usuario se ha desconectado de SOCKET.IO', client.id);

    // Remover usuario del chat si existe
    for (const [username, user] of this.users.entries()) {
      if (user.socket === client) {
        this.users.delete(username);
        // console.log(`Usuario desconectado del chat: ${username}`);
        this.broadcastUserList();
        break;
      }
    }
  }

  handleConnection(client: Socket) {
    // console.log('Un usuario se ha conectado a SOCKET.IO', client.id);
  }

  // ===== EVENTOS DEL CHAT =====

  @SubscribeMessage('register')
  handleRegister(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { username: string; userData: any },
  ) {
    const { username, userData } = data;
    this.users.set(username, { socket: client, userData });
    // console.log(`Usuario registrado en chat: ${username}`);
    // console.log(`Datos del usuario:`, userData);
    // console.log(`Rol del usuario:`, userData?.role);

    // Enviar confirmación de registro
    client.emit('info', {
      message: `Registrado como ${username}`,
    });

    // Enviar lista de usuarios
    this.broadcastUserList();
  }

  @SubscribeMessage('message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    const {
      to,
      message,
      isGroup,
      time,
      from,
      fromId,
      mediaType,
      mediaData,
      fileName,
    } = data;

    // console.log(`📨 MENSAGE RECIBIDO:`, data);
    // console.log(`🔍 Usuario que envía: ${from} (ID: ${fromId})`);
    // console.log(`🔍 Es grupo: ${isGroup}`);
    // console.log(`🔍 Destinatario: ${to}`);
    // console.log(
    //   `🔍 Media: ${mediaType ? `${mediaType} - ${fileName} (${mediaData ? 'con datos' : 'sin datos'})` : 'No'}`,
    // );

    if (isGroup) {
      // Verificar si es una sala temporal
      const user = this.users.get(from);
      // console.log(`🔍 Usuario encontrado:`, user ? 'Sí' : 'No');
      // console.log(`🔍 currentRoom del usuario:`, user?.currentRoom);

      if (user && user.currentRoom) {
        // Es una sala temporal
        const roomCode = user.currentRoom;
        const roomUsers = this.roomUsers.get(roomCode);
        // console.log(`🔍 Sala temporal encontrada: ${roomCode}`);
        // console.log(
        //   `🔍 Usuarios en la sala:`,
        //   roomUsers ? Array.from(roomUsers) : 'No encontrada',
        // );

        if (roomUsers) {
          // console.log(
          //   `📨 Enviando mensaje a sala temporal ${roomCode}:`,
          //   message,
          // );
          // console.log(`👥 Usuarios en la sala:`, Array.from(roomUsers));

          roomUsers.forEach((member) => {
            const memberUser = this.users.get(member);
            // console.log(
            //   `🔍 Usuario ${member} encontrado:`,
            //   memberUser ? 'Sí' : 'No',
            // );
            // console.log(`🔍 Socket conectado:`, memberUser?.socket.connected);

            if (memberUser && memberUser.socket.connected) {
              // console.log(
              //   `📤 Enviando mensaje a ${member} en sala ${roomCode}`,
              // );
              memberUser.socket.emit('message', {
                from: from || 'Usuario Desconocido',
                group: to,
                message,
                isGroup: true,
                time: time || new Date().toLocaleTimeString(),
              });
            } else {
              // console.log(
              //   `❌ No se puede enviar a ${member} - usuario no encontrado o socket desconectado`,
              // );
            }
          });
        } else {
          // console.log(`❌ No se encontró la sala ${roomCode} en roomUsers`);
        }
      } else {
        console.log(
          `❌ Usuario no tiene currentRoom, tratando como grupo normal`,
        );
        // Es un grupo normal
        const group = this.groups.get(to);
        if (group) {
          const groupMembers = Array.from(group);
          groupMembers.forEach((member) => {
            const user = this.users.get(member);
            if (user && user.socket.connected) {
              user.socket.emit('message', {
                from: from || 'Usuario Desconocido',
                group: to,
                message,
                isGroup: true,
                time: time || new Date().toLocaleTimeString(),
              });
            }
          });
        }
      }
    } else {
      // Mensaje individual
      const recipient = this.users.get(to);
      if (recipient && recipient.socket.connected) {
        recipient.socket.emit('message', {
          from: from || 'Usuario Desconocido',
          to,
          message,
          isGroup: false,
          time: time || new Date().toLocaleTimeString(),
        });
      }
    }

    // Guardar mensaje en la base de datos (después de enviar)
    this.saveMessageToDatabase(data).catch((error) => {
      // console.error(`❌ Error al guardar mensaje en BD:`, error);
    });
  }

  private async saveMessageToDatabase(data: any) {
    const {
      to,
      message,
      isGroup,
      time,
      from,
      fromId,
      mediaType,
      mediaData,
      fileName,
    } = data;

    try {
      const messageData = {
        from,
        fromId,
        to: isGroup ? null : to,
        message,
        isGroup,
        groupName: isGroup ? to : null,
        roomCode: isGroup ? this.getRoomCodeFromUser(from) : null,
        mediaType,
        mediaData,
        fileName,
        sentAt: new Date(),
        time: time || new Date().toLocaleTimeString(),
      };

      // console.log(`💾 Guardando mensaje en BD:`, messageData);
      await this.messagesService.create(messageData);
      // console.log(`✅ Mensaje guardado exitosamente en BD`);
    } catch (error) {
      // console.error(`❌ Error al guardar mensaje en BD:`, error);
    }
  }

  @SubscribeMessage('createGroup')
  handleCreateGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupName: string; members: string[]; from: string },
  ) {
    const { groupName, members, from } = data;
    const groupMembers = new Set(members);
    groupMembers.add(from || 'Usuario');
    this.groups.set(groupName, groupMembers);
    // console.log(
    //   `Grupo creado: ${groupName} con miembros: ${Array.from(groupMembers).join(', ')}`,
    // );
    this.broadcastGroupList();
  }

  @SubscribeMessage('joinGroup')
  handleJoinGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupName: string; from: string },
  ) {
    const { groupName, from } = data;
    const groupToJoin = this.groups.get(groupName);
    if (groupToJoin) {
      groupToJoin.add(from || 'Usuario');
      // console.log(`Usuario ${from} se unió al grupo ${groupName}`);
      this.broadcastGroupList();
    }
  }

  @SubscribeMessage('leaveGroup')
  handleLeaveGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupName: string; from: string },
  ) {
    const { groupName, from } = data;
    const groupToLeave = this.groups.get(groupName);
    if (groupToLeave) {
      groupToLeave.delete(from || 'Usuario');
      // console.log(`Usuario ${from} salió del grupo ${groupName}`);
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
    const { linkType, participants, roomName, from } = data;
    const linkId = this.generateTemporaryLink(linkType, participants, from);
    const linkUrl = `http://localhost:8080/#/join/${linkId}`;

    client.emit('temporaryLinkCreated', {
      linkId,
      linkUrl,
      expiresAt: this.temporaryLinks.get(linkId).expiresAt.toISOString(),
      linkType,
      participants: participants || [],
      roomName: roomName || null,
    });
  }

  @SubscribeMessage('joinTemporaryLink')
  handleJoinTemporaryLink(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { linkId: string; from: string },
  ) {
    const { linkId, from } = data;
    const link = this.temporaryLinks.get(linkId);

    if (link && link.isActive && link.expiresAt > new Date()) {
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
    @MessageBody() data: { roomCode: string; roomName: string; from: string },
  ) {
    const { roomCode, roomName, from } = data;
    // console.log(
    //   `🏠 Usuario ${from} se une a la sala ${roomCode} (${roomName})`,
    // );

    try {
      // Actualizar la base de datos usando el servicio
      const joinDto = { roomCode, username: from };
      await this.temporaryRoomsService.joinRoom(joinDto, from);
      // console.log(`✅ Usuario ${from} unido a la sala en la base de datos`);
    } catch (error) {
      // console.error(`❌ Error al unir usuario ${from} a la sala en BD:`, error);
    }

    // Agregar usuario a la sala en memoria
    if (!this.roomUsers.has(roomCode)) {
      this.roomUsers.set(roomCode, new Set());
    }
    this.roomUsers.get(roomCode)!.add(from);

    // Actualizar la sala actual del usuario
    const user = this.users.get(from);
    // console.log(
    //   `🔍 Usuario ${from} encontrado en joinRoom:`,
    //   user ? 'Sí' : 'No',
    // );
    if (user) {
      user.currentRoom = roomCode;
      // console.log(`📍 Usuario ${from} ahora está en la sala ${roomCode}`);
      // console.log(`📍 currentRoom actualizado a:`, user.currentRoom);
    } else {
      // console.log(`❌ Usuario ${from} no encontrado en this.users`);
      // console.log(`🔍 Usuarios disponibles:`, Array.from(this.users.keys()));
    }

    // Notificar a todos en la sala
    this.broadcastRoomUsers(roomCode);

    // Confirmar al usuario que se unió
    client.emit('roomJoined', {
      roomCode,
      roomName,
      users: Array.from(this.roomUsers.get(roomCode) || []),
    });

    // console.log(`✅ Usuario ${from} unido exitosamente a la sala ${roomCode}`);
  }

  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomCode: string; from: string },
  ) {
    const { roomCode, from } = data;
    // console.log(`🚪 Usuario ${from} sale de la sala ${roomCode}`);

    try {
      // Remover usuario de la base de datos
      await this.temporaryRoomsService.leaveRoom(roomCode, from);
      // console.log(`✅ Usuario ${from} removido de la sala en BD`);
    } catch (error) {
      // console.error(`❌ Error al remover usuario ${from} de la sala en BD:`, error);
    }

    // Remover usuario de la sala en memoria
    const roomUsersSet = this.roomUsers.get(roomCode);
    if (roomUsersSet) {
      roomUsersSet.delete(from);
      if (roomUsersSet.size === 0) {
        this.roomUsers.delete(roomCode);
      }
    }

    // Limpiar sala actual del usuario
    const user = this.users.get(from);
    if (user) {
      user.currentRoom = undefined;
    }

    // Notificar a todos en la sala
    this.broadcastRoomUsers(roomCode);

    // Reenviar lista general de usuarios (ya que salió de la sala)
    this.broadcastUserList();

    // console.log(`✅ Usuario ${from} salió de la sala ${roomCode}`);
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
      createdAt: new Date(),
    });

    return linkId;
  }

  private cleanExpiredLinks() {
    const now = new Date();
    for (const [linkId, link] of this.temporaryLinks.entries()) {
      if (link.expiresAt < now) {
        this.temporaryLinks.delete(linkId);
      }
    }
  }

  private broadcastUserList() {
    const userList = Array.from(this.users.keys());
    // console.log('📋 Enviando lista de usuarios:', userList);

    this.users.forEach(({ socket, userData, currentRoom }) => {
      if (socket.connected) {
        // Si el usuario está en una sala, no enviar lista general
        if (currentRoom) {
          // console.log(
          //   `🚫 Usuario ${userData?.username || 'Usuario'} está en sala ${currentRoom}, no enviar lista general`,
          // );
          return;
        }

        // Solo enviar lista completa a usuarios admin (cuando NO están en una sala)
        const isAdmin =
          userData?.role &&
          userData.role.toString().toUpperCase().trim() === 'ADMIN';

        if (isAdmin) {
          // console.log(
          //   `👑 Enviando lista completa a admin: ${userData.username || 'Usuario'}`,
          // );
          socket.emit('userList', { users: userList });
        } else {
          // Para usuarios no admin, enviar solo su propio nombre
          const ownUsername = userData?.username || 'Usuario';
          // console.log(`👤 Enviando solo su nombre a usuario: ${ownUsername}`);
          socket.emit('userList', { users: [ownUsername] });
        }
      }
    });
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

  private broadcastRoomUsers(roomCode: string) {
    const roomUsersList = Array.from(this.roomUsers.get(roomCode) || []);
    // console.log(`📋 Enviando usuarios de la sala ${roomCode}:`, roomUsersList);
    // console.log(`🔍 Estado completo de roomUsers:`, this.roomUsers);
    // console.log(
    //   `🔍 Estado completo de users:`,
    //   Array.from(this.users.entries()).map(([name, data]) => ({
    //     name,
    //     currentRoom: data.currentRoom,
    //   })),
    // );

    // Enviar solo a usuarios que están en esta sala
    this.users.forEach(({ socket, userData, currentRoom }) => {
      // console.log(
      //   `🔍 Usuario: ${userData?.username || 'Unknown'}, currentRoom: ${currentRoom}, roomCode: ${roomCode}, connected: ${socket.connected}`,
      // );
      if (socket.connected && currentRoom === roomCode) {
        // console.log(
        //   `📤 Enviando lista de sala a usuario ${userData?.username || 'Unknown'} en ${roomCode}`,
        // );
        socket.emit('roomUsers', {
          roomCode,
          users: roomUsersList,
        });
      } else {
        // console.log(
        //   `❌ No enviando a ${userData?.username || 'Unknown'} - connected: ${socket.connected}, currentRoom: ${currentRoom}, roomCode: ${roomCode}`,
        // );
      }
    });
  }
}
