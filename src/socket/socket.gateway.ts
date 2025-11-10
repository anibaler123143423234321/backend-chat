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
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { TemporaryRoomsService } from '../temporary-rooms/temporary-rooms.service';
import { MessagesService } from '../messages/messages.service';
import { User } from '../users/entities/user.entity';

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
    @InjectRepository(User)
    private userRepository: Repository<User>,
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
  async handleRegister(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { username: string; userData: any; assignedConversations?: any[] },
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

    // Enviar confirmación de registro
    client.emit('info', {
      message: `Registrado como ${username}`,
    });

    // Enviar lista de usuarios (incluyendo usuarios de conversaciones asignadas si aplica)
    this.broadcastUserList(assignedConversations);
  }

  @SubscribeMessage('requestUserListPage')
  handleRequestUserListPage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { page: number; pageSize: number },
  ) {
    console.log(`📄 WS: requestUserListPage - Página: ${data.page}, Tamaño: ${data.pageSize}`);

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
      numeroAgente: userData?.numeroAgente || null,
    }));

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
      hasMore: end < userListWithData.length
    });
  }

  @SubscribeMessage('updateAssignedConversations')
  async handleUpdateAssignedConversations(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { username: string; assignedConversations: any[] },
  ) {
    console.log(`🔄 WS: updateAssignedConversations - Usuario: ${data.username}`);

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
                if (usersToSend.some(u => u.username === participantName)) {
                  continue;
                }

                // Primero buscar en usuarios conectados
                let participantData = connectedUsersMap.get(participantName);

                if (participantData) {
                  // Usuario está conectado
                  usersToSend.push(participantData);
                } else {
                  // Usuario NO está conectado, buscar en la base de datos
                  try {
                    // Buscar por nombre completo (participantName puede ser "Nombre Apellido")
                    const dbUser = await this.userRepository
                      .createQueryBuilder('user')
                      .where('CONCAT(user.nombre, " ", user.apellido) = :fullName', { fullName: participantName })
                      .orWhere('user.username = :username', { username: participantName })
                      .getOne();

                    if (dbUser) {
                      // Agregar usuario de la BD con isOnline = false
                      usersToSend.push({
                        id: dbUser.id || null,
                        username: dbUser.nombre && dbUser.apellido
                          ? `${dbUser.nombre} ${dbUser.apellido}`
                          : dbUser.username,
                        nombre: dbUser.nombre || null,
                        apellido: dbUser.apellido || null,
                        email: dbUser.email || null,
                        role: dbUser.role || 'USER', // 🔥 Obtener role de la BD
                        picture: null, // No tenemos picture en la entidad User de chat
                        sede: null,
                        sede_id: null,
                        numeroAgente: dbUser.numeroAgente || null, // 🔥 Obtener numeroAgente de la BD
                        isOnline: false, // Usuario NO conectado
                      });
                    }
                  } catch (error) {
                    console.error(`❌ Error al buscar usuario ${participantName} en BD:`, error);
                  }
                }
              }
            }
          }
        }
      }

      console.log(`📤 Enviando lista de usuarios a ${data.username}:`, usersToSend.map(u => `${u.username} (${u.isOnline ? 'online' : 'offline'})`));
      userConnection.socket.emit('userList', { users: usersToSend });
    }
  }

  @SubscribeMessage('conversationAssigned')
  handleConversationAssigned(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { user1: string; user2: string; conversationName: string; linkId: string; assignedConversations?: any[] },
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

    // 🔥 NUEVO: Actualizar la lista de usuarios de ambos participantes para que se vean mutuamente
    // Esto asegura que ambos usuarios vean al otro en su lista inmediatamente después de la asignación
    const userListWithData = Array.from(this.users.entries()).map(([username, { userData }]) => {
      // Calcular el nombre completo para comparación
      const fullName = userData?.nombre && userData?.apellido
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
    });

    // Actualizar lista de user1 para incluir a user2
    if (user1Connection && user1Connection.socket.connected) {
      const isAdmin = user1Connection.userData?.role?.toString().toUpperCase().trim() === 'ADMIN';

      if (!isAdmin) {
        // Para usuarios no admin, enviar lista actualizada con el otro participante
        const usersToSend = [];

        // Agregar información del usuario actual (buscar por username o fullName)
        const ownUserData = userListWithData.find(u =>
          u.username === data.user1 || u.fullName === data.user1
        );
        if (ownUserData) {
          // Remover fullName antes de enviar
          const { fullName, ...userDataToSend } = ownUserData;
          usersToSend.push(userDataToSend);
        }

        // Agregar información del otro participante (buscar por username o fullName)
        const user2Data = userListWithData.find(u =>
          u.username === data.user2 || u.fullName === data.user2
        );
        if (user2Data) {
          // Remover fullName antes de enviar
          const { fullName, ...userDataToSend } = user2Data;
          usersToSend.push(userDataToSend);
        }

        console.log(`🔄 Actualizando lista de usuarios para ${data.user1}:`, usersToSend.map(u => u.username));
        user1Connection.socket.emit('userList', { users: usersToSend });
      }
    }

    // Actualizar lista de user2 para incluir a user1
    if (user2Connection && user2Connection.socket.connected) {
      const isAdmin = user2Connection.userData?.role?.toString().toUpperCase().trim() === 'ADMIN';

      if (!isAdmin) {
        // Para usuarios no admin, enviar lista actualizada con el otro participante
        const usersToSend = [];

        // Agregar información del usuario actual (buscar por username o fullName)
        const ownUserData = userListWithData.find(u =>
          u.username === data.user2 || u.fullName === data.user2
        );
        if (ownUserData) {
          // Remover fullName antes de enviar
          const { fullName, ...userDataToSend } = ownUserData;
          usersToSend.push(userDataToSend);
        }

        // Agregar información del otro participante (buscar por username o fullName)
        const user1Data = userListWithData.find(u =>
          u.username === data.user1 || u.fullName === data.user1
        );
        if (user1Data) {
          // Remover fullName antes de enviar
          const { fullName, ...userDataToSend } = user1Data;
          usersToSend.push(userDataToSend);
        }

        console.log(`🔄 Actualizando lista de usuarios para ${data.user2}:`, usersToSend.map(u => u.username));
        user2Connection.socket.emit('userList', { users: usersToSend });
      }
    }
  }

  @SubscribeMessage('conversationUpdated')
  handleConversationUpdated(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { participants: string[]; conversationName: string; conversationId: string },
  ) {
    console.log(`🔄 WS: conversationUpdated - ${data.conversationName} (ID: ${data.conversationId})`);

    // Notificar a todos los participantes que la conversación fue actualizada
    if (data.participants && Array.isArray(data.participants)) {
      data.participants.forEach(participantName => {
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
    @MessageBody() data: { from: string; to: string; isTyping: boolean; roomCode?: string },
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
    console.log(`📨 WS: message - De: ${data.from}, Para: ${data.to}, Grupo: ${data.isGroup}`);
    console.log(`📦 Datos completos del mensaje:`, {
      from: data.from,
      to: data.to,
      isGroup: data.isGroup,
      isAssignedConversation: data.isAssignedConversation,
      actualRecipient: data.actualRecipient,
      message: data.message?.substring(0, 50)
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
    } = data;

    // 🔥 Obtener información del remitente (role y numeroAgente)
    const senderUser = this.users.get(from);
    const senderRole = senderUser?.userData?.role || null;
    const senderNumeroAgente = senderUser?.userData?.numeroAgente || null;

    // 🔥 GUARDAR MENSAJE EN BD PRIMERO para obtener el ID
    let savedMessage = null;
    try {
      savedMessage = await this.saveMessageToDatabase({
        ...data,
        senderRole, // 🔥 Incluir role del remitente
        senderNumeroAgente, // 🔥 Incluir numeroAgente del remitente
      });
      console.log(`✅ Mensaje guardado en BD con ID: ${savedMessage?.id}`);
    } catch (error) {
      console.error(`❌ Error al guardar mensaje en BD:`, error);
    }

    if (isGroup) {
      console.log(`🔵 Procesando mensaje de GRUPO`);
      // Verificar si es una sala temporal
      const user = this.users.get(from);
      console.log(`👤 Usuario remitente:`, {
        username: from,
        currentRoom: user?.currentRoom,
        hasUser: !!user
      });

      if (user && user.currentRoom) {
        // Es una sala temporal
        const roomCode = user.currentRoom;
        const roomUsers = this.roomUsers.get(roomCode);
        console.log(`🏠 Enviando a sala temporal: ${roomCode}, Miembros: ${roomUsers?.size || 0}`);

        if (roomUsers) {
          roomUsers.forEach((member) => {
            const memberUser = this.users.get(member);

            if (memberUser && memberUser.socket.connected) {
              memberUser.socket.emit('message', {
                id: savedMessage?.id, // 🔥 Incluir ID del mensaje
                from: from || 'Usuario Desconocido',
                senderRole, // 🔥 Incluir role del remitente
                senderNumeroAgente, // 🔥 Incluir numeroAgente del remitente
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
        console.log(`👥 Enviando a grupo normal: ${to}, Miembros: ${group?.size || 0}`);
        if (group) {
          const groupMembers = Array.from(group);
          groupMembers.forEach((member) => {
            const user = this.users.get(member);
            if (user && user.socket.connected) {
              user.socket.emit('message', {
                id: savedMessage?.id, // 🔥 Incluir ID del mensaje
                from: from || 'Usuario Desconocido',
                senderRole, // 🔥 Incluir role del remitente
                senderNumeroAgente, // 🔥 Incluir numeroAgente del remitente
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
      console.log(`🔴 Procesando mensaje INDIVIDUAL (1-a-1)`);
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

      // 🔥 Búsqueda case-insensitive del destinatario
      let recipient = this.users.get(recipientUsername);

      // Si no se encuentra con el nombre exacto, buscar case-insensitive
      if (!recipient) {
        const recipientNormalized = recipientUsername?.toLowerCase().trim();
        const foundUsername = Array.from(this.users.keys()).find(
          key => key?.toLowerCase().trim() === recipientNormalized
        );
        if (foundUsername) {
          recipient = this.users.get(foundUsername);
          console.log(`✅ Usuario encontrado con búsqueda case-insensitive: ${foundUsername}`);
        }
      }

      if (recipient && recipient.socket.connected) {
        console.log(`✅ Enviando mensaje a ${recipientUsername} (socket conectado)`);
        console.log(`📦 Datos del mensaje:`, {
          id: savedMessage?.id,
          from,
          to: recipientUsername,
          message: message?.substring(0, 50),
          isGroup: false
        });

        recipient.socket.emit('message', {
          id: savedMessage?.id, // 🔥 Incluir ID del mensaje guardado en BD
          from: from || 'Usuario Desconocido',
          senderRole, // 🔥 Incluir role del remitente
          senderNumeroAgente, // 🔥 Incluir numeroAgente del remitente
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

        console.log(`✅ Mensaje emitido exitosamente a ${recipientUsername}`);
      } else {
        console.log(`❌ No se pudo enviar mensaje a ${recipientUsername} (usuario no conectado o no encontrado)`);
        if (recipient) {
          console.log(`   Socket conectado: ${recipient.socket.connected}`);
        } else {
          console.log(`   Destinatario no encontrado en el Map de usuarios`);
        }
      }
    }
  }

  private async saveMessageToDatabase(data: any) {
    const {
      to,
      message,
      isGroup,
      time,
      from,
      fromId,
      senderRole, // 🔥 Extraer role del remitente
      senderNumeroAgente, // 🔥 Extraer numeroAgente del remitente
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
        senderRole, // 🔥 Incluir role del remitente
        senderNumeroAgente, // 🔥 Incluir numeroAgente del remitente
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
      const savedMessage = await this.messagesService.create(messageData);
      console.log(`✅ Mensaje guardado exitosamente en BD con ID: ${savedMessage.id}`);
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

  private async broadcastUserList(assignedConversations?: any[]) {
    // Crear lista de usuarios conectados con toda su información
    const connectedUsersMap = new Map<string, any>();
    const userListWithData = Array.from(this.users.entries()).map(([username, { userData }]) => {
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
    });

    // console.log('📋 Enviando lista de usuarios con datos completos:', userListWithData);

    // Procesar cada usuario conectado
    for (const [username, { socket, userData, currentRoom }] of this.users.entries()) {
      if (socket.connected) {
        // Si el usuario está en una sala, no enviar lista general
        if (currentRoom) {
          // console.log(
          //   `🚫 Usuario ${userData?.username || 'Usuario'} está en sala ${currentRoom}, no enviar lista general`,
          // );
          continue;
        }

        // Solo enviar lista completa a usuarios admin (cuando NO están en una sala)
        const isAdmin =
          userData?.role &&
          userData.role.toString().toUpperCase().trim() === 'ADMIN';

        if (isAdmin) {
          // console.log(
          //   `👑 Enviando lista paginada a admin: ${userData.username || 'Usuario'}`,
          // );
          // Enviar solo los primeros 10 usuarios (página 0)
          const pageSize = 10;
          const firstPage = userListWithData.slice(0, pageSize);
          socket.emit('userList', {
            users: firstPage,
            page: 0,
            pageSize: pageSize,
            totalUsers: userListWithData.length,
            hasMore: userListWithData.length > pageSize
          });
        } else {
          // Para usuarios no admin, incluir su propia información + usuarios de conversaciones asignadas
          const usersToSend = [];

          // Agregar información del usuario actual
          const ownUserData = connectedUsersMap.get(userData?.username);
          if (ownUserData) {
            usersToSend.push(ownUserData);
          }

          // Si tiene conversaciones asignadas, agregar información de los otros usuarios
          if (assignedConversations && assignedConversations.length > 0) {
            for (const conv of assignedConversations) {
              if (conv.participants && Array.isArray(conv.participants)) {
                for (const participantName of conv.participants) {
                  // No agregar al usuario actual
                  if (participantName !== userData?.username) {
                    // Verificar si ya está en la lista
                    if (usersToSend.some(u => u.username === participantName)) {
                      continue;
                    }

                    // Primero buscar en usuarios conectados
                    let participantData = connectedUsersMap.get(participantName);

                    if (participantData) {
                      // Usuario está conectado
                      usersToSend.push(participantData);
                    } else {
                      // Usuario NO está conectado, buscar en la base de datos
                      try {
                        // Buscar por nombre completo (participantName puede ser "Nombre Apellido")
                        const dbUser = await this.userRepository
                          .createQueryBuilder('user')
                          .where('CONCAT(user.nombre, " ", user.apellido) = :fullName', { fullName: participantName })
                          .orWhere('user.username = :username', { username: participantName })
                          .getOne();

                        if (dbUser) {
                          // Agregar usuario de la BD con isOnline = false
                          usersToSend.push({
                            id: dbUser.id || null,
                            username: dbUser.nombre && dbUser.apellido
                              ? `${dbUser.nombre} ${dbUser.apellido}`
                              : dbUser.username,
                            nombre: dbUser.nombre || null,
                            apellido: dbUser.apellido || null,
                            email: dbUser.email || null,
                            role: dbUser.role || 'USER', // 🔥 Obtener role de la BD
                            picture: null, // No tenemos picture en la entidad User de chat
                            sede: null,
                            sede_id: null,
                            numeroAgente: dbUser.numeroAgente || null, // 🔥 Obtener numeroAgente de la BD
                            isOnline: false, // Usuario NO conectado
                          });
                        }
                      } catch (error) {
                        console.error(`❌ Error al buscar usuario ${participantName} en BD:`, error);
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
        role: user?.userData?.role || null,
        numeroAgente: user?.userData?.numeroAgente || null,
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

  // ==================== MENSAJES LEÍDOS ====================

  @SubscribeMessage('markAsRead')
  async handleMarkAsRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: number; username: string; from: string },
  ) {
    console.log(`✅ WS: markAsRead - Mensaje ${data.messageId} leído por ${data.username}`);

    try {
      // Marcar el mensaje como leído en la base de datos
      const message = await this.messagesService.markAsRead(data.messageId, data.username);

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
    console.log(`✅ WS: markConversationAsRead - Conversación de ${data.from} a ${data.to} marcada como leída`);

    try {
      // Marcar todos los mensajes de la conversación como leídos
      const messages = await this.messagesService.markConversationAsRead(data.from, data.to);

      if (messages.length > 0) {
        // 🔥 Búsqueda case-insensitive del remitente
        let senderUser = this.users.get(data.from);

        if (!senderUser) {
          const senderNormalized = data.from?.toLowerCase().trim();
          const foundUsername = Array.from(this.users.keys()).find(
            key => key?.toLowerCase().trim() === senderNormalized
          );
          if (foundUsername) {
            senderUser = this.users.get(foundUsername);
            console.log(`✅ Remitente encontrado con búsqueda case-insensitive: ${foundUsername}`);
          }
        }

        // Notificar al remitente que sus mensajes fueron leídos
        if (senderUser && senderUser.socket.connected) {
          console.log(`📨 Notificando a ${data.from} que sus mensajes fueron leídos por ${data.to}`);
          senderUser.socket.emit('conversationRead', {
            readBy: data.to,
            messageIds: messages.map(m => m.id),
            readAt: new Date(),
          });
        } else {
          console.log(`❌ No se pudo notificar a ${data.from} (usuario no conectado o no encontrado)`);
        }

        // Confirmar al lector
        client.emit('conversationReadConfirmed', {
          messagesUpdated: messages.length,
          readAt: new Date(),
        });
      }
    } catch (error) {
      console.error('Error al marcar conversación como leída:', error);
      client.emit('error', { message: 'Error al marcar conversación como leída' });
    }
  }

  @SubscribeMessage('markRoomMessageAsRead')
  async handleMarkRoomMessageAsRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: number; username: string; roomCode: string },
  ) {
    console.log(`✅ WS: markRoomMessageAsRead - Mensaje ${data.messageId} en sala ${data.roomCode} leído por ${data.username}`);

    try {
      // Marcar el mensaje como leído en la base de datos
      const message = await this.messagesService.markAsRead(data.messageId, data.username);

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
      client.emit('error', { message: 'Error al marcar mensaje de sala como leído' });
    }
  }

  // ==================== MENSAJES DE HILO ====================

  @SubscribeMessage('threadMessage')
  async handleThreadMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    console.log(`🧵 WS: threadMessage - ThreadID: ${data.threadId}, De: ${data.from}, Para: ${data.to}`);

    try {
      const { threadId, from, to, isGroup, roomCode } = data;

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
        // Enviar al remitente (para sincronizar otras pestañas/dispositivos)
        const senderUser = this.users.get(from);
        if (senderUser && senderUser.socket.connected) {
          senderUser.socket.emit('threadMessage', data);
        }

        // Enviar al destinatario
        const recipientUser = this.users.get(to);
        if (recipientUser && recipientUser.socket.connected) {
          recipientUser.socket.emit('threadMessage', data);
        }
      }

      console.log(`✅ Mensaje de hilo enviado correctamente`);
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
    console.log(`🔢 WS: threadCountUpdated - MessageID: ${data.messageId}, LastReply: ${data.lastReplyFrom}`);

    try {
      const { messageId, lastReplyFrom, isGroup, roomCode, to, from } = data;

      if (isGroup && roomCode) {
        // Actualización en grupo/sala - enviar a todos los miembros de la sala
        const roomUsers = this.roomUsers.get(roomCode);
        if (roomUsers) {
          roomUsers.forEach((member) => {
            const memberUser = this.users.get(member);
            if (memberUser && memberUser.socket.connected) {
              memberUser.socket.emit('threadCountUpdated', {
                messageId,
                lastReplyFrom
              });
            }
          });
        }
      } else {
        // Actualización en conversación 1-a-1
        // Enviar al destinatario
        const recipientUser = this.users.get(to);
        if (recipientUser && recipientUser.socket.connected) {
          recipientUser.socket.emit('threadCountUpdated', {
            messageId,
            lastReplyFrom
          });
        }

        // 🔥 TAMBIÉN enviar al remitente para que vea el contador actualizado
        const senderUser = this.users.get(from);
        if (senderUser && senderUser.socket.connected && from !== to) {
          senderUser.socket.emit('threadCountUpdated', {
            messageId,
            lastReplyFrom
          });
        }
      }

      console.log(`✅ Contador de hilo actualizado correctamente`);
    } catch (error) {
      console.error('❌ Error al actualizar contador de hilo:', error);
      client.emit('error', { message: 'Error al actualizar contador de hilo' });
    }
  }

  // ==================== REACCIONES A MENSAJES ====================

  @SubscribeMessage('toggleReaction')
  async handleToggleReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: number; username: string; emoji: string; roomCode?: string; to?: string },
  ) {
    console.log(`😊 WS: toggleReaction - Mensaje ${data.messageId}, Usuario: ${data.username}, Emoji: ${data.emoji}`);

    try {
      const message = await this.messagesService.toggleReaction(
        data.messageId,
        data.username,
        data.emoji,
      );

      if (message) {
        // Emitir la actualización a todos los usuarios relevantes
        if (data.roomCode) {
          // Si es un mensaje de sala, notificar a todos los miembros
          const roomUsers = this.roomUsers.get(data.roomCode);
          if (roomUsers) {
            roomUsers.forEach((member) => {
              const memberUser = this.users.get(member);
              if (memberUser && memberUser.socket.connected) {
                memberUser.socket.emit('reactionUpdated', {
                  messageId: data.messageId,
                  reactions: message.reactions,
                  roomCode: data.roomCode,
                });
              }
            });
          }
        } else if (data.to) {
          // Si es un mensaje 1-a-1, notificar al otro usuario
          const otherUser = this.users.get(data.to);
          if (otherUser && otherUser.socket.connected) {
            otherUser.socket.emit('reactionUpdated', {
              messageId: data.messageId,
              reactions: message.reactions,
              to: data.to,
            });
          }

          // También notificar al usuario que reaccionó
          client.emit('reactionUpdated', {
            messageId: data.messageId,
            reactions: message.reactions,
            to: data.to,
          });
        }
      }
    } catch (error) {
      console.error('Error al alternar reacción:', error);
      client.emit('error', { message: 'Error al alternar reacción' });
    }
  }

  // ==================== NOTIFICACIONES DE SALAS ====================

  /**
   * Notificar a todos los usuarios ADMIN y JEFEPISO que se creó una nueva sala
   */
  broadcastRoomCreated(room: any) {
    console.log(`✨ Broadcasting room created: ${room.roomCode} (ID: ${room.id})`);

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
      console.log(`📢 Notificando a ${roomMembers.size} miembros de la sala ${roomCode}`);

      roomMembers.forEach((username) => {
        const userConnection = this.users.get(username);
        if (userConnection && userConnection.socket.connected) {
          console.log(`✅ Notificando a ${username} que la sala fue desactivada`);
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
    console.log(`➕ Notificando a ${username} que fue agregado a la sala ${roomCode}`);

    const userConnection = this.users.get(username);
    if (userConnection && userConnection.socket.connected) {
      console.log(`✅ Usuario ${username} está conectado, enviando notificación`);
      userConnection.socket.emit('addedToRoom', {
        roomCode,
        roomName,
        message: `Has sido agregado a la sala: ${roomName}`,
      });
    } else {
      console.log(`❌ Usuario ${username} NO está conectado o no existe en el mapa de usuarios`);
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
}
