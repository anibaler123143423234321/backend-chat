import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('chat_users')
@Index('IDX_users_role', ['role'])
@Index('IDX_users_numeroAgente', ['numeroAgente'])
@Index('IDX_users_email', ['email'])
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  username: string;

  @Column({ nullable: true })
  nombre: string;

  @Column({ nullable: true })
  apellido: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  currentRoomCode: string;

  @Column({ nullable: true })
  role: string;

  @Column({ nullable: true })
  numeroAgente: string;

  @Column({ nullable: true, type: 'text' })
  picture: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
