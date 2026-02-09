import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity('chat_users')
@Index('IDX_users_role', ['role'])
@Index('IDX_users_numeroAgente', ['numeroAgente'])
@Index('IDX_users_email', ['email'])
export class User {
  @ApiProperty()
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty()
  @Column({ unique: true })
  username: string;

  @ApiProperty({ required: false })
  @Column({ nullable: true })
  nombre: string;

  @ApiProperty({ required: false })
  @Column({ nullable: true })
  apellido: string;

  @ApiProperty({ required: false })
  @Column({ nullable: true })
  email: string;

  @ApiProperty({ required: false })
  @Column({ nullable: true })
  currentRoomCode: string;

  @ApiProperty({ required: false })
  @Column({ nullable: true })
  role: string;

  @ApiProperty({ required: false })
  @Column({ nullable: true })
  numeroAgente: string;

  @ApiProperty({ required: false })
  @Column({ nullable: true, type: 'text' })
  picture: string;

  @ApiProperty()
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn()
  updatedAt: Date;
}
