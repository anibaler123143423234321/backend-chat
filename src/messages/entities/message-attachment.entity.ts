import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    JoinColumn,
    CreateDateColumn,
} from 'typeorm';
import { Message } from './message.entity';

@Entity('message_attachments')
export class MessageAttachment {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'longtext' })
    url: string;

    @Column({ length: 50, nullable: true })
    type: string;

    @Column({ length: 255, nullable: true })
    fileName: string;

    @Column({ type: 'int', nullable: true })
    fileSize: number;

    @ManyToOne(() => Message, (message) => message.attachments, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'messageId' })
    message: Message;

    @Column()
    messageId: number;

    @CreateDateColumn()
    createdAt: Date;
}
