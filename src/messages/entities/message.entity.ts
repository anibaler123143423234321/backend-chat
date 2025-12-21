import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { TemporaryRoom } from '../../temporary-rooms/entities/temporary-room.entity';

// 🚀 ÍNDICES PARA OPTIMIZAR CONSULTAS FRECUENTES
// Estos índices mejoran significativamente el rendimiento de las consultas de mensajes
@Entity('messages')
@Index('IDX_messages_roomCode', ['roomCode'])
@Index('IDX_messages_conversationId', ['conversationId'])
@Index('IDX_messages_threadId', ['threadId'])
@Index('IDX_messages_isGroup', ['isGroup'])
@Index('IDX_messages_isDeleted', ['isDeleted'])
@Index('IDX_messages_sentAt', ['sentAt'])
// Índices compuestos para consultas más comunes
@Index('IDX_messages_room_thread_deleted', ['roomCode', 'threadId', 'isDeleted'])
@Index('IDX_messages_conv_thread_deleted', ['conversationId', 'threadId', 'isDeleted'])
@Index('IDX_messages_from_to_group', ['from', 'to', 'isGroup'])
export class Message {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  from: string;

  @Column({ type: 'int', nullable: true })
  fromId: number;

  @Column({ length: 50, nullable: true })
  senderRole: string; // Role del remitente

  @Column({ length: 20, nullable: true })
  senderNumeroAgente: string; // Número de agente del remitente

  @Column({ length: 255, nullable: true })
  to: string;

  @Column({ type: 'text', nullable: true })
  message: string;

  @Column({ type: 'boolean', default: false })
  isGroup: boolean;

  @Column({ length: 50, nullable: true })
  groupName: string;

  @Column({ length: 50, nullable: true })
  roomCode: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  mediaType: string; // 'image', 'video', 'audio', 'document'

  @Column({ type: 'longtext', nullable: true })
  mediaData: string; // URL del archivo (o Base64 para compatibilidad)

  @Column({ length: 255, nullable: true })
  fileName: string;

  @Column({ type: 'int', nullable: true })
  fileSize: number; // Tamaño del archivo en bytes

  @Column({ type: 'datetime' })
  sentAt: Date;

  @Column({ type: 'boolean', default: false })
  isRead: boolean;

  @Column({ type: 'datetime', nullable: true })
  readAt: Date; // Fecha y hora en que se leyó el mensaje

  @Column({ type: 'json', nullable: true })
  readBy: string[]; // Array de usuarios que han leído el mensaje

  @Column({ type: 'boolean', default: false })
  isDeleted: boolean;

  @Column({ type: 'datetime', nullable: true })
  deletedAt: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  deletedBy: string; // Nombre del usuario que eliminó el mensaje (para ADMIN)

  @Column({ type: 'boolean', default: false })
  isEdited: boolean;

  @Column({ type: 'datetime', nullable: true })
  editedAt: Date;

  @Column({ type: 'varchar', length: 20, nullable: true })
  time: string; // Formato HH:MM

  // Campos para responder mensajes
  @Column({ type: 'int', nullable: true })
  replyToMessageId: number; // ID del mensaje al que se responde

  @Column({ type: 'varchar', length: 255, nullable: true })
  replyToSender: string; // Nombre del remitente del mensaje original

  @Column({ type: 'text', nullable: true })
  replyToText: string; // Texto del mensaje original (preview)

  @Column({ type: 'varchar', length: 20, nullable: true })
  replyToSenderNumeroAgente: string; // Número de agente del remitente original

  // Campos para hilos de conversación
  @Column({ type: 'int', nullable: true })
  threadId: number; // ID del mensaje principal del hilo (null si es mensaje principal)

  @Column({ type: 'int', default: 0 })
  threadCount: number; // Cantidad de respuestas en el hilo

  @Column({ type: 'varchar', length: 255, nullable: true })
  lastReplyFrom: string; // Nombre del último usuario que respondió en el hilo

  // Campos para reacciones a mensajes
  @Column({ type: 'json', nullable: true })
  reactions: { emoji: string; username: string; timestamp: Date }[]; // Array de reacciones

  // 🔥 NUEVO: Campos para videollamadas
  @Column({ type: 'varchar', length: 50, nullable: true })
  type: string; // 'text', 'video_call', 'audio_call', etc.

  @Column({ type: 'varchar', length: 500, nullable: true })
  videoCallUrl: string; // URL de la videollamada

  @Column({ type: 'varchar', length: 100, nullable: true })
  videoRoomID: string; // ID de la sala de videollamada

  @Column({ type: 'json', nullable: true })
  metadata: any; // Metadata adicional (JSON flexible)

  // Relación con la sala temporal (opcional)
  @ManyToOne(() => TemporaryRoom, { nullable: true })
  @JoinColumn({ name: 'roomId' })
  room: TemporaryRoom;

  @Column({ type: 'int', nullable: true })
  conversationId: number; // 🔥 NUEVO: ID de la conversación asignada (TemporaryConversation)

  @Column({ type: 'int', nullable: true })
  roomId: number;

  // 🔥 Campo simple para indicar mensaje reenviado
  @Column({ type: 'boolean', default: false })
  isForwarded: boolean; // Indica si el mensaje fue reenviado

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
