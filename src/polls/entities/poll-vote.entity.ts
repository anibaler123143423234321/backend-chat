import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
    JoinColumn,
} from 'typeorm';
import { Poll } from './poll.entity';

@Entity('poll_votes')
export class PollVote {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar', length: 255 })
    username: string; // Usuario que votó

    @Column({ type: 'int' })
    optionIndex: number; // Índice de la opción votada (0, 1, 2, ...)

    // Relación muchos a uno con Poll
    @ManyToOne(() => Poll, (poll) => poll.votes, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'pollId' })
    poll: Poll;

    @Column({ type: 'int' })
    pollId: number;

    @CreateDateColumn()
    votedAt: Date;
}
