import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('temporary_conversations')
export class TemporaryConversation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 500, nullable: true })
  description: string;

  @Column({ length: 50, unique: true })
  linkId: string;

  @Column({ type: 'datetime' })
  expiresAt: Date;

  @Column({ type: 'int', default: 0 })
  maxParticipants: number;

  @Column({ type: 'int', default: 0 })
  currentParticipants: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'json', nullable: true })
  participants: string[];

  @Column({ type: 'boolean', default: false })
  isAssignedByAdmin: boolean; // Indica si fue asignada por un admin

  @Column({ type: 'json', nullable: true })
  assignedUsers: string[]; // Usuarios asignados (no pueden salir)

  @Column({ type: 'json', nullable: true })
  settings: any;

  @Column()
  createdBy: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
