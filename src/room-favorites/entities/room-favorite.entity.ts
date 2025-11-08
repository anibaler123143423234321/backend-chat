import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

@Entity('room_favorites')
@Unique(['username', 'roomCode']) // Un usuario solo puede tener una sala favorita una vez
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

