import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
    JoinColumn,
} from 'typeorm';
import { Poll } from './poll.entity';
import { PollOption } from './poll-option.entity';

@Entity('poll_votes')
export class PollVote {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar', length: 255 })
    username: string; // Usuario que votó

    @ManyToOne(() => PollOption, (option) => option.votes, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'optionId' })
    option: PollOption;

    @Column({ type: 'int' })
    optionId: number;

    // Relación muchos a uno con Poll
    @ManyToOne(() => Poll, (poll) => poll.votes, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'pollId' })
    poll: Poll;

    @Column({ type: 'int' })
    pollId: number;

    @CreateDateColumn()
    votedAt: Date;
}
