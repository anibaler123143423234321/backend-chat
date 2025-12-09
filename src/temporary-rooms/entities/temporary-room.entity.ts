import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

// 🚀 ÍNDICES PARA OPTIMIZAR CONSULTAS DE SALAS TEMPORALES
@Entity('temporary_rooms')
@Index('IDX_temp_rooms_roomCode', ['roomCode'])
@Index('IDX_temp_rooms_isActive', ['isActive'])
@Index('IDX_temp_rooms_isAssignedByAdmin', ['isAssignedByAdmin'])
@Index('IDX_temp_rooms_createdBy', ['createdBy'])
@Index('IDX_temp_rooms_active_assigned', ['isActive', 'isAssignedByAdmin'])
export class TemporaryRoom {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 500, nullable: true })
  description: string;

  @Column({ length: 50, unique: true })
  roomCode: string;

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

  @Column({ type: 'int', nullable: true })
  pinnedMessageId: number; // ID del mensaje fijado actualmente (null si no hay mensaje fijado)

  @Column()
  createdBy: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
