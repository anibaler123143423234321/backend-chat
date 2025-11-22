import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    OneToOne,
    JoinColumn,
    OneToMany,
} from 'typeorm';
import { Message } from '../../messages/entities/message.entity';
import { PollVote } from './poll-vote.entity';

@Entity('polls')
export class Poll {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar', length: 500 })
    question: string;

    @Column({ type: 'json' })
    options: string[]; // Array de opciones ["Opción 1", "Opción 2", ...]

    @Column({ type: 'varchar', length: 255 })
    createdBy: string; // Username del creador

    @Column({ type: 'boolean', default: false })
    allowMultipleVotes: boolean; // Permitir votos múltiples (para futuro)

    @Column({ type: 'datetime', nullable: true })
    expiresAt: Date; // Fecha de expiración (opcional)

    // Relación uno a uno con Message
    @OneToOne(() => Message, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'messageId' })
    message: Message;

    @Column({ type: 'int' })
    messageId: number;

    // Relación uno a muchos con PollVote
    @OneToMany(() => PollVote, (vote) => vote.poll, { cascade: true })
    votes: PollVote[];

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
