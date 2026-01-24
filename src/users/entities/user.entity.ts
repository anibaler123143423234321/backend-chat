import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('chat_users')
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
