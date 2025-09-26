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
  private users = new Map<string, { socket: Socket; userData: any }>();
  private groups = new Map<string, Set<string>>();
  private temporaryLinks = new Map<string, any>();
  private publicRooms = new Map<string, any>();

  constructor() {
    // Limpiar enlaces expirados cada 5 minutos
    setInterval(() => this.cleanExpiredLinks(), 5 * 60 * 1000);
  }

  handleDisconnect(client: Socket) {
    console.log('Un usuario se ha desconectado de SOCKET.IO', client.id);

    // Remover usuario del chat si existe
    for (const [username, user] of this.users.entries()) {
      if (user.socket === client) {
        this.users.delete(username);
        console.log(`Usuario desconectado del chat: ${username}`);
        this.broadcastUserList();
        break;
      }
    }
  }

  handleConnection(client: Socket) {
    console.log('Un usuario se ha conectado a SOCKET.IO', client.id);
  }

  // ===== EVENTOS DEL CHAT =====

  @SubscribeMessage('register')
  handleRegister(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { username: string; userData: any },
  ) {
    const { username, userData } = data;
    this.users.set(username, { socket: client, userData });
    console.log(`Usuario registrado en chat: ${username}`);

    // Enviar confirmación de registro
    client.emit('info', {
      message: `Registrado como ${username}`,
    });

    // Enviar lista de usuarios
    this.broadcastUserList();
  }

  @SubscribeMessage('message')
  handleMessage(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    const { to, message, isGroup, time, from } = data;

    if (isGroup) {
      // Mensaje de grupo
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
    console.log(
      `Grupo creado: ${groupName} con miembros: ${Array.from(groupMembers).join(', ')}`,
    );
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
      console.log(`Usuario ${from} se unió al grupo ${groupName}`);
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
      console.log(`Usuario ${from} salió del grupo ${groupName}`);
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

  // ===== MÉTODOS PRIVADOS DEL CHAT =====

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
    this.users.forEach(({ socket }) => {
      if (socket.connected) {
        socket.emit('userList', { users: userList });
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
}
