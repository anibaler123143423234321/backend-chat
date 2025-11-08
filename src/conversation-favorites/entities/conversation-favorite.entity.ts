import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

@Entity('conversation_favorites')
@Unique(['username', 'conversationId']) // Un usuario solo puede tener una conversación favorita una vez
export class ConversationFavorite {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  username: string;

  @Column({ type: 'int' })
  conversationId: number;

  @Column({ type: 'boolean', default: true })
  isPinned: boolean; // Si está fijada al inicio

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

