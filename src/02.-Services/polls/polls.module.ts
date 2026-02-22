import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Poll } from 'src/02.-Services/polls/entities/poll.entity';
import { PollVote } from 'src/02.-Services/polls/entities/poll-vote.entity';
import { PollOption } from 'src/02.-Services/polls/entities/poll-option.entity';
import { PollsService } from 'src/02.-Services/polls/polls.service';

@Module({
    imports: [TypeOrmModule.forFeature([Poll, PollVote, PollOption])],
    providers: [PollsService],
    exports: [PollsService],
})
export class PollsModule { }
