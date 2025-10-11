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
  members: string[]; // Historial de todos los usuarios que han entrado

  @Column({ type: 'json', nullable: true })
  connectedMembers: string[]; // Usuarios actualmente conectados

  @Column({ type: 'json', nullable: true })
  assignedMembers: string[]; // Usuarios asignados por admin (no pueden salir)

  @Column({ type: 'boolean', default: false })
  isAssignedByAdmin: boolean; // Indica si la sala fue asignada por un admin

  @Column({ type: 'json', nullable: true })
  settings: any;

  @Column()
  createdBy: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
