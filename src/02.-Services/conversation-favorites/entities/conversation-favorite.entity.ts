import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TemporaryConversation } from 'src/02.-Services/temporary-conversations/entities/temporary-conversation.entity';

// 🚀 ÍNDICES PARA OPTIMIZAR CONSULTAS DE FAVORITOS
@Entity('conversation_favorites')
@Unique(['username', 'conversationId'])
@Index('IDX_conv_favorites_username', ['username'])
@Index('IDX_conv_favorites_conversationId', ['conversationId'])
@Index('IDX_conv_favorites_isPinned', ['isPinned'])
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

  @ManyToOne(() => TemporaryConversation, { eager: false, createForeignKeyConstraints: false })
  @JoinColumn({ name: 'conversationId', referencedColumnName: 'id' })
  conversation: TemporaryConversation;
}

