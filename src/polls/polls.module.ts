import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Poll } from './entities/poll.entity';
import { PollVote } from './entities/poll-vote.entity';
import { PollOption } from './entities/poll-option.entity';
import { PollsService } from './polls.service';

@Module({
    imports: [TypeOrmModule.forFeature([Poll, PollVote, PollOption])],
    providers: [PollsService],
    exports: [PollsService],
})
export class PollsModule { }
