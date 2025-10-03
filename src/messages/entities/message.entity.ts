import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TemporaryRoom } from '../../temporary-rooms/entities/temporary-room.entity';

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  from: string;

  @Column({ type: 'int', nullable: true })
  fromId: number;

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

  @Column({ type: 'json', nullable: true })
  readBy: string[]; // Array de usuarios que han leído el mensaje

  @Column({ type: 'boolean', default: false })
  isDeleted: boolean;

  @Column({ type: 'datetime', nullable: true })
  deletedAt: Date;

  @Column({ type: 'boolean', default: false })
  isEdited: boolean;

  @Column({ type: 'datetime', nullable: true })
  editedAt: Date;

  @Column({ type: 'varchar', length: 20, nullable: true })
  time: string; // Formato HH:MM

  // Relación con la sala temporal (opcional)
  @ManyToOne(() => TemporaryRoom, { nullable: true })
  @JoinColumn({ name: 'roomId' })
  room: TemporaryRoom;

  @Column({ type: 'int', nullable: true })
  roomId: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
