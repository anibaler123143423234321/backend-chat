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
  transports: ['websocket', 'polling'],
  path: '/socket.io/',
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

    // Inyectar referencia del gateway en el servicio para notificaciones
    this.temporaryRoomsService.setSocketGateway(this);
  }

  async handleDisconnect(client: Socket) {
    // Remover usuario del chat si existe
    for (const [username, user] of this.users.entries()) {
      if (user.socket === client) {
        // Si el usuario estaba en una sala, solo removerlo de la memoria (NO de la BD)
        if (user.currentRoom) {
          const roomCode = user.currentRoom;

          // NO remover de la base de datos - mantener en el historial
          // Solo remover de la memoria para marcarlo como desconectado
          const roomUsersSet = this.roomUsers.get(roomCode);
          if (roomUsersSet) {
            roomUsersSet.delete(username);
            if (roomUsersSet.size === 0) {
              this.roomUsers.delete(roomCode);
            }
          }

          // Notificar a otros usuarios de la sala que este usuario se desconectó
          await this.broadcastRoomUsers(roomCode);
        }

        // Remover usuario del mapa de usuarios conectados
        this.users.delete(username);
        this.broadcastUserList();
        break;
      }
    }
  }

  handleConnection(_client: Socket) {
    // Socket.IO connection established
  }

  // ===== EVENTOS DEL CHAT =====

  @SubscribeMessage('register')
  handleRegister(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { username: string; userData: any; assignedConversations?: any[] },
  ) {
    console.log(`📝 WS: register - Usuario: ${data.username}`);
    const { username, userData, assignedConversations } = data;
    this.users.set(username, { socket: client, userData });

    // Enviar confirmación de registro
    client.emit('info', {
      message: `Registrado como ${username}`,
    });

    // Enviar lista de usuarios (incluyendo usuarios de conversaciones asignadas si aplica)
    this.broadcastUserList(assignedConversations);
  }

  @SubscribeMessage('updateAssignedConversations')
  handleUpdateAssignedConversations(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { username: string; assignedConversations: any[] },
  ) {
    console.log(`🔄 WS: updateAssignedConversations - Usuario: ${data.username}`);

    // Actualizar la lista de usuarios para este usuario específico
    const userConnection = this.users.get(data.username);
    if (userConnection && userConnection.socket.connected) {
      // Crear lista de usuarios con toda su información
      const userListWithData = Array.from(this.users.entries()).map(([uname, { userData }]) => ({
        id: userData?.id || null,
        username: uname,
        nombre: userData?.nombre || null,
        apellido: userData?.apellido || null,
        email: userData?.email || null,
        role: userData?.role || 'USER',
        picture: userData?.picture || null,
        sede: userData?.sede || null,
        sede_id: userData?.sede_id || null,
      }));

      // Incluir información del usuario actual + usuarios de conversaciones asignadas
      const usersToSend = [];

      // Agregar información del usuario actual
      const ownUserData = userListWithData.find(u => u.username === data.username);
      if (ownUserData) {
        usersToSend.push(ownUserData);
      }

      // Agregar información de los otros usuarios en las conversaciones asignadas
      if (data.assignedConversations && data.assignedConversations.length > 0) {
        data.assignedConversations.forEach(conv => {
          if (conv.participants && Array.isArray(conv.participants)) {
            conv.participants.forEach(participantName => {
              if (participantName !== data.username) {
                const participantData = userListWithData.find(u => u.username === participantName);
                if (participantData && !usersToSend.some(u => u.username === participantName)) {
                  usersToSend.push(participantData);
                }
              }
            });
          }
        });
      }

      userConnection.socket.emit('userList', { users: usersToSend });
    }
  }

  @SubscribeMessage('conversationAssigned')
  handleConversationAssigned(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { user1: string; user2: string; conversationName: string; linkId: string },
  ) {
    console.log(`💬 WS: conversationAssigned - ${data.conversationName} entre ${data.user1} y ${data.user2}`);

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
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { from: string; to: string; isTyping: boolean },
  ) {
    // Buscar la conexión del destinatario
    const recipientConnection = this.users.get(data.to);

    if (recipientConnection && recipientConnection.socket.connected) {
      recipientConnection.socket.emit('userTyping', {
        from: data.from,
        isTyping: data.isTyping,
      });
    }
  }

  @SubscribeMessage('message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    console.log(`📨 WS: message - De: ${data.from}, Para: ${data.to}, Grupo: ${data.isGroup}`);

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
    } = data;

    if (isGroup) {
      // Verificar si es una sala temporal
      const user = this.users.get(from);

      if (user && user.currentRoom) {
        // Es una sala temporal
        const roomCode = user.currentRoom;
        const roomUsers = this.roomUsers.get(roomCode);

        if (roomUsers) {
          roomUsers.forEach((member) => {
            const memberUser = this.users.get(member);

            if (memberUser && memberUser.socket.connected) {
              memberUser.socket.emit('message', {
                from: from || 'Usuario Desconocido',
                group: to,
                message,
                isGroup: true,
                time: time || new Date().toLocaleTimeString(),
                mediaType,
                mediaData,
                fileName,
                fileSize,
                replyToMessageId,
                replyToSender,
                replyToText,
              });
            }
          });
        }
      } else {
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
                mediaType,
                mediaData,
                fileName,
                fileSize,
                replyToMessageId,
                replyToSender,
                replyToText,
              });
            }
          });
        }
      }
    } else {
      // Mensaje individual
      let recipientUsername = to;

      // Si es una conversación asignada, obtener el destinatario real
      if (data.isAssignedConversation && data.actualRecipient) {
        recipientUsername = data.actualRecipient;
        console.log(`📧 Conversación asignada detectada. Destinatario real: ${recipientUsername}`);
      }

      // Log de usuarios conectados
      const connectedUsers = Array.from(this.users.keys());
      console.log(`👥 Usuarios conectados: ${connectedUsers.join(', ')}`);
      console.log(`🔍 Buscando destinatario: ${recipientUsername}`);

      const recipient = this.users.get(recipientUsername);
      if (recipient && recipient.socket.connected) {
        console.log(`✅ Enviando mensaje a ${recipientUsername} (socket conectado)`);
        recipient.socket.emit('message', {
          from: from || 'Usuario Desconocido',
          to: recipientUsername,
          message,
          isGroup: false,
          time: time || new Date().toLocaleTimeString(),
          mediaType,
          mediaData,
          fileName,
          fileSize,
          replyToMessageId,
          replyToSender,
          replyToText,
        });
      } else {
        console.log(`❌ No se pudo enviar mensaje a ${recipientUsername} (usuario no conectado o no encontrado)`);
        if (recipient) {
          console.log(`   Socket conectado: ${recipient.socket.connected}`);
        }
      }
    }

    // Guardar mensaje en la base de datos (después de enviar)
    this.saveMessageToDatabase(data).catch(() => {
      // Error al guardar en BD
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
      fileSize,
      replyToMessageId,
      replyToSender,
      replyToText,
      isAssignedConversation,
      actualRecipient,
    } = data;

    try {
      // Si es una conversación asignada, usar el destinatario real
      let recipientForDB = to;
      if (isAssignedConversation && actualRecipient) {
        recipientForDB = actualRecipient;
      }

      const messageData = {
        from,
        fromId,
        to: isGroup ? null : recipientForDB,
        message,
        isGroup,
        groupName: isGroup ? to : null,
        roomCode: isGroup ? this.getRoomCodeFromUser(from) : null,
        mediaType,
        mediaData,
        fileName,
        fileSize,
        sentAt: new Date(),
        time: time || new Date().toLocaleTimeString(),
        replyToMessageId,
        replyToSender,
        replyToText,
      };

      console.log(`💾 Guardando mensaje en BD:`, messageData);
      await this.messagesService.create(messageData);
      console.log(`✅ Mensaje guardado exitosamente en BD`);
    } catch (error) {
      console.error(`❌ Error al guardar mensaje en BD:`, error);
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
      to: string;
      isGroup: boolean;
      roomCode?: string;
    },
  ) {
    console.log(`✏️ WS: editMessage - ID: ${data.messageId}, Usuario: ${data.username}`);

    try {
      // Editar mensaje en la base de datos
      const editedMessage = await this.messagesService.editMessage(
        data.messageId,
        data.username,
        data.newText,
      );

      if (editedMessage) {
        // Emitir evento de mensaje editado
        const editEvent = {
          messageId: data.messageId,
          newText: data.newText,
          editedAt: editedMessage.editedAt,
          isEdited: true,
        };

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
        }
      }
    } catch (error) {
      console.error('❌ Error al editar mensaje:', error);
    }
  }

  @SubscribeMessage('createGroup')
  handleCreateGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupName: string; members: string[]; from: string },
  ) {
    console.log(`👥 WS: createGroup - Grupo: ${data.groupName}`);
    const groupMembers = new Set(data.members);
    groupMembers.add(data.from || 'Usuario');
    this.groups.set(data.groupName, groupMembers);
    this.broadcastGroupList();
  }

  @SubscribeMessage('joinGroup')
  handleJoinGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupName: string; from: string },
  ) {
    console.log(`➕ WS: joinGroup - Usuario: ${data.from}, Grupo: ${data.groupName}`);
    const groupToJoin = this.groups.get(data.groupName);
    if (groupToJoin) {
      groupToJoin.add(data.from || 'Usuario');
      this.broadcastGroupList();
    }
  }

  @SubscribeMessage('leaveGroup')
  handleLeaveGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupName: string; from: string },
  ) {
    console.log(`➖ WS: leaveGroup - Usuario: ${data.from}, Grupo: ${data.groupName}`);
    const groupToLeave = this.groups.get(data.groupName);
    if (groupToLeave) {
      groupToLeave.delete(data.from || 'Usuario');
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
    console.log(`🔗 WS: createTemporaryLink - Tipo: ${data.linkType}, De: ${data.from}`);
    const linkId = this.generateTemporaryLink(data.linkType, data.participants, data.from);
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
    console.log(`🏠 WS: joinRoom - Usuario: ${data.from}, Sala: ${data.roomCode}`);

    try {
      // Actualizar la base de datos usando el servicio
      const joinDto = { roomCode: data.roomCode, username: data.from };
      await this.temporaryRoomsService.joinRoom(joinDto, data.from);
    } catch (error) {
      // Error al unir en BD
    }

    // Agregar usuario a la sala en memoria
    if (!this.roomUsers.has(data.roomCode)) {
      this.roomUsers.set(data.roomCode, new Set());
    }
    this.roomUsers.get(data.roomCode)!.add(data.from);

    // Actualizar la sala actual del usuario
    const user = this.users.get(data.from);
    if (user) {
      user.currentRoom = data.roomCode;
    }

    // Notificar a todos en la sala
    await this.broadcastRoomUsers(data.roomCode);

    // Obtener historial completo de usuarios para roomJoined
    const connectedUsernamesList = Array.from(this.roomUsers.get(data.roomCode) || []);
    let allUsernames: string[] = [];
    try {
      const room = await this.temporaryRoomsService.findByRoomCode(data.roomCode);
      allUsernames = room.members || [];
    } catch (error) {
      allUsernames = connectedUsernamesList;
    }

    // Crear lista con TODOS los usuarios (historial) y su estado de conexión
    const roomUsersList = allUsernames.map(username => {
      const user = this.users.get(username);
      const isOnline = connectedUsernamesList.includes(username);
      return {
        id: user?.userData?.id || null,
        username: username,
        picture: user?.userData?.picture || null,
        nombre: user?.userData?.nombre || null,
        apellido: user?.userData?.apellido || null,
        sede: user?.userData?.sede || null,
        sede_id: user?.userData?.sede_id || null,
        isOnline: isOnline
      };
    });

    // Confirmar al usuario que se unió
    client.emit('roomJoined', {
      roomCode: data.roomCode,
      roomName: data.roomName,
      users: roomUsersList,
    });
  }

  @SubscribeMessage('kickUser')
  async handleKickUser(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomCode: string; username: string; kickedBy: string },
  ) {
    console.log(`👢 WS: kickUser - Usuario: ${data.username}, Sala: ${data.roomCode}, Expulsado por: ${data.kickedBy}`);

    // Verificar que quien expulsa sea admin
    const kickerUser = this.users.get(data.kickedBy);
    if (!kickerUser || !kickerUser.userData) {
      console.log('❌ Usuario que intenta expulsar no encontrado');
      return;
    }

    const kickerRole = kickerUser.userData.role?.toString().toUpperCase().trim();
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

    // Actualizar lista de usuarios en la sala
    const roomUsersList = Array.from(roomUsersSet || []);
    this.server.to(data.roomCode).emit('roomUsers', {
      roomCode: data.roomCode,
      users: roomUsersList,
    });

    console.log(`✅ Usuario ${data.username} expulsado de la sala ${data.roomCode}`);
  }

  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomCode: string; from: string },
  ) {
    console.log(`🚪 WS: leaveRoom - Usuario: ${data.from}, Sala: ${data.roomCode}`);

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

  private broadcastUserList(assignedConversations?: any[]) {
    // Crear lista de usuarios con toda su información
    const userListWithData = Array.from(this.users.entries()).map(([username, { userData }]) => ({
      id: userData?.id || null,
      username: username,
      nombre: userData?.nombre || null,
      apellido: userData?.apellido || null,
      email: userData?.email || null,
      role: userData?.role || 'USER',
      picture: userData?.picture || null,
      sede: userData?.sede || null,
      sede_id: userData?.sede_id || null,
    }));

    // console.log('📋 Enviando lista de usuarios con datos completos:', userListWithData);

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
          socket.emit('userList', { users: userListWithData });
        } else {
          // Para usuarios no admin, incluir su propia información + usuarios de conversaciones asignadas
          const usersToSend = [];

          // Agregar información del usuario actual
          const ownUserData = userListWithData.find(u => u.username === userData?.username);
          if (ownUserData) {
            usersToSend.push(ownUserData);
          }

          // Si tiene conversaciones asignadas, agregar información de los otros usuarios
          if (assignedConversations && assignedConversations.length > 0) {
            assignedConversations.forEach(conv => {
              if (conv.participants && Array.isArray(conv.participants)) {
                conv.participants.forEach(participantName => {
                  // No agregar al usuario actual
                  if (participantName !== userData?.username) {
                    const participantData = userListWithData.find(u => u.username === participantName);
                    if (participantData && !usersToSend.some(u => u.username === participantName)) {
                      usersToSend.push(participantData);
                    }
                  }
                });
              }
            });
          }

          // console.log(`👤 Enviando información a usuario: ${userData?.username}`, usersToSend);
          socket.emit('userList', { users: usersToSend });
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

  private async broadcastRoomUsers(roomCode: string) {
    const connectedUsernamesList = Array.from(this.roomUsers.get(roomCode) || []);

    // Obtener el historial completo de usuarios de la base de datos
    let allUsernames: string[] = [];
    try {
      const room = await this.temporaryRoomsService.findByRoomCode(roomCode);
      allUsernames = room.members || [];
    } catch (error) {
      // Si hay error, usar solo los usuarios conectados
      allUsernames = connectedUsernamesList;
    }

    // Crear lista con TODOS los usuarios (historial) y su estado de conexión
    const roomUsersList = allUsernames.map(username => {
      const user = this.users.get(username);
      const isOnline = connectedUsernamesList.includes(username);
      return {
        id: user?.userData?.id || null,
        username: username,
        picture: user?.userData?.picture || null,
        nombre: user?.userData?.nombre || null,
        apellido: user?.userData?.apellido || null,
        sede: user?.userData?.sede || null,
        sede_id: user?.userData?.sede_id || null,
        isOnline: isOnline
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

    // Notificar a todos los ADMIN y JEFEPISO sobre el cambio en el contador de usuarios
    this.broadcastRoomCountUpdate(roomCode, roomUsersList.length);
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
    @MessageBody() data: { userToCall: string; signalData: any; from: string; callType: string },
  ) {
    console.log(`📞 WS: callUser - De: ${data.from}, Para: ${data.userToCall}, Tipo: ${data.callType}`);

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

  // ==================== NOTIFICACIONES DE SALAS ====================

  /**
   * Notificar a todos los usuarios ADMIN y JEFEPISO que una sala fue eliminada/desactivada
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
  }
}
