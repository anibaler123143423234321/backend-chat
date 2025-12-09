import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
  Index,
} from 'typeorm';

// 🚀 ÍNDICES PARA OPTIMIZAR CONSULTAS DE FAVORITOS DE SALAS
@Entity('room_favorites')
@Unique(['username', 'roomCode'])
@Index('IDX_room_favorites_username', ['username'])
@Index('IDX_room_favorites_roomCode', ['roomCode'])
@Index('IDX_room_favorites_roomId', ['roomId'])
@Index('IDX_room_favorites_isPinned', ['isPinned'])
export class RoomFavorite {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  username: string;

  @Column({ length: 50 })
  roomCode: string;

  @Column({ type: 'int' })
  roomId: number;

  @Column({ type: 'boolean', default: true })
  isPinned: boolean; // Si está fijada al inicio

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

