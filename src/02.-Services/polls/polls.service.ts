import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Poll } from 'src/02.-Services/polls/entities/poll.entity';
import { PollVote } from 'src/02.-Services/polls/entities/poll-vote.entity';
import { PollOption } from 'src/02.-Services/polls/entities/poll-option.entity';
import { CreatePollDto } from 'src/02.-Services/polls/dto/create-poll.dto';

@Injectable()
export class PollsService {
    constructor(
        @InjectRepository(Poll)
        private pollRepository: Repository<Poll>,
        @InjectRepository(PollVote)
        private pollVoteRepository: Repository<PollVote>,
        @InjectRepository(PollOption)
        private pollOptionRepository: Repository<PollOption>,
    ) { }

    async createPoll(
        createPollDto: CreatePollDto,
        messageId: number,
        createdBy: string,
    ): Promise<Poll> {
        console.log(`📝 Creating poll for message ${messageId} with ${createPollDto.options?.length} options`);

        // Usar cascade para guardar poll y opciones juntos
        const poll = this.pollRepository.create({
            question: createPollDto.question,
            createdBy,
            messageId,
            options: createPollDto.options?.map(text => this.pollOptionRepository.create({
                text,
                votesCount: 0
            })) || []
        });

        // Al guardar el poll, se guardan las opciones automáticamente gracias a cascade: true en la entidad
        const savedPoll = await this.pollRepository.save(poll);
        console.log(`✅ Poll saved with ID: ${savedPoll.id}`);

        return this.getPollByMessageId(messageId);
    }

    async getPollByMessageId(messageId: number): Promise<Poll | null> {
        return await this.pollRepository.findOne({
            where: { messageId },
            relations: ['options', 'options.votes'], // Cargar opciones y sus votos
            order: {
                options: {
                    id: 'ASC' // Mantener orden de inserción por ID
                }
            }
        });
    }

    async vote(
        pollId: number,
        username: string,
        optionIndex: number,
    ): Promise<PollVote> {
        console.log(`🗳️ [DEBUG] PollsService.vote START: PollID=${pollId}, User=${username}, Index=${optionIndex}`);

        // Obtener encuesta y sus opciones ordenadas
        const poll = await this.pollRepository.findOne({
            where: { id: pollId },
            relations: ['options'],
            order: {
                options: { id: 'ASC' }
            }
        });

        if (!poll) {
            console.error(`❌ [DEBUG] Poll ${pollId} NOT FOUND`);
            throw new Error('Encuesta no encontrada');
        }

        console.log(`🗳️ [DEBUG] Poll found. Options in DB: ${poll.options?.length}`);
        if (!poll.options || poll.options.length === 0) {
            console.error(`❌ [DEBUG] Poll ${pollId} HAS NO OPTIONS! Relation returned empty.`);
        } else {
            poll.options.forEach((o, i) => console.log(`   [DEBUG] Option[${i}]: ID=${o.id}, Text='${o.text}'`));
        }

        if (!poll.options || !poll.options[optionIndex]) {
            console.error(`❌ [DEBUG] Invalid Index ${optionIndex}. Available: ${poll.options?.length}`);
            throw new Error('Opción inválida o encuesta no encontrada');
        }

        const targetOption = poll.options[optionIndex];
        console.log(`✅ [DEBUG] Target option valid: ID=${targetOption.id}`);

        // Verificar si el usuario ya votó
        const existingVote = await this.pollVoteRepository.findOne({
            where: {
                username,
                option: {
                    pollId: pollId
                }
            },
            relations: ['option']
        });

        if (existingVote) {
            console.log(`ℹ️ [DEBUG] User already voted for option ${existingVote.option.id}`);
            // Si votó por la MISMA opción, retorno directo
            if (existingVote.option.id === targetOption.id) {
                console.log(`⏭️ [DEBUG] Same option, skipping update.`);
                return existingVote;
            }

            // Cambiar de voto
            console.log(`🔄 [DEBUG] Changing vote from ${existingVote.option.id} to ${targetOption.id}`);
            await this.pollOptionRepository.decrement({ id: existingVote.option.id }, 'votesCount', 1);

            existingVote.option = targetOption;
            const savedVote = await this.pollVoteRepository.save(existingVote);
            await this.pollOptionRepository.increment({ id: targetOption.id }, 'votesCount', 1);

            return savedVote;
        }

        // Crear nuevo voto
        console.log(`🆕 [DEBUG] Creating NEW vote for user ${username}`);
        try {
            const vote = this.pollVoteRepository.create({
                username,
                option: targetOption,
                optionId: targetOption.id, // Explicitly set ID
                poll: { id: pollId } as any, // Relation
                pollId: pollId // Explicitly set ID
            });

            // FIX: Explicitly set optionId if needed, but option object should work.
            // Using option relationship is better.

            const savedVote = await this.pollVoteRepository.save(vote);
            console.log(`✅ [DEBUG] Vote saved with ID=${savedVote.id}`);

            // Incrementar contador
            await this.pollOptionRepository.increment({ id: targetOption.id }, 'votesCount', 1);

            return savedVote;
        } catch (error) {
            console.error(`❌ [DEBUG] Error saving vote:`, error);
            throw error;
        }
    }

    async getPollWithVotes(pollId: number): Promise<Poll | null> {
        return await this.pollRepository.findOne({
            where: { id: pollId },
            relations: ['options', 'options.votes'],
            order: {
                options: { id: 'ASC' }
            }
        });
    }

    async removeVote(pollId: number, username: string): Promise<boolean> {
        const existingVote = await this.pollVoteRepository.findOne({
            where: {
                username,
                option: { pollId }
            },
            relations: ['option']
        });

        if (existingVote) {
            await this.pollVoteRepository.remove(existingVote);
            await this.pollOptionRepository.decrement({ id: existingVote.option.id }, 'votesCount', 1);
            return true;
        }
        return false;
    }
}
