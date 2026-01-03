import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    OneToMany,
    JoinColumn,
} from 'typeorm';
import { Poll } from './poll.entity';
import { PollVote } from './poll-vote.entity';

@Entity('poll_options')
export class PollOption {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar', length: 255 })
    text: string;

    @Column({ type: 'int', default: 0 })
    votesCount: number;

    @ManyToOne(() => Poll, (poll) => poll.options, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'pollId' })
    poll: Poll;

    @Column({ type: 'int' })
    pollId: number;

    @OneToMany(() => PollVote, (vote) => vote.option)
    votes: PollVote[];
}
