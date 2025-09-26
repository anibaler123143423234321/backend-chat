import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('temporary_rooms')
export class TemporaryRoom {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 500, nullable: true })
  description: string;

  @Column({ length: 50, unique: true })
  roomCode: string;

  @Column({ type: 'datetime' })
  expiresAt: Date;

  @Column({ type: 'int', default: 50 })
  maxCapacity: number;

  @Column({ type: 'int', default: 0 })
  currentMembers: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'json', nullable: true })
  members: string[];

  @Column({ type: 'json', nullable: true })
  settings: any;

  @Column()
  createdBy: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
