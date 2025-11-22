import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Poll } from './entities/poll.entity';
import { PollVote } from './entities/poll-vote.entity';
import { CreatePollDto } from './dto/create-poll.dto';

@Injectable()
export class PollsService {
    constructor(
        @InjectRepository(Poll)
        private pollRepository: Repository<Poll>,
        @InjectRepository(PollVote)
        private pollVoteRepository: Repository<PollVote>,
    ) { }

    async createPoll(
        createPollDto: CreatePollDto,
        messageId: number,
        createdBy: string,
    ): Promise<Poll> {
        const poll = this.pollRepository.create({
            question: createPollDto.question,
            options: createPollDto.options,
            createdBy,
            messageId,
        });

        return await this.pollRepository.save(poll);
    }

    async getPollByMessageId(messageId: number): Promise<Poll | null> {
        return await this.pollRepository.findOne({
            where: { messageId },
            relations: ['votes'],
        });
    }

    async vote(
        pollId: number,
        username: string,
        optionIndex: number,
    ): Promise<PollVote> {
        // Verificar si el usuario ya votó
        const existingVote = await this.pollVoteRepository.findOne({
            where: { pollId, username },
        });

        if (existingVote) {
            // Actualizar el voto
            existingVote.optionIndex = optionIndex;
            return await this.pollVoteRepository.save(existingVote);
        }

        // Crear nuevo voto
        const vote = this.pollVoteRepository.create({
            pollId,
            username,
            optionIndex,
        });

        return await this.pollVoteRepository.save(vote);
    }

    async getPollWithVotes(pollId: number): Promise<Poll | null> {
        return await this.pollRepository.findOne({
            where: { id: pollId },
            relations: ['votes'],
        });
    }

    async removeVote(pollId: number, username: string): Promise<boolean> {
        const result = await this.pollVoteRepository.delete({ pollId, username });
        return result.affected > 0;
    }
}
