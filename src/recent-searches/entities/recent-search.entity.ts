import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum SearchType {
  USER = 'user',
  ROOM = 'room',
  MESSAGE = 'message',
  GENERAL = 'general',
}

@Entity('recent_searches')
export class RecentSearch {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  username: string;

  @Column({ type: 'varchar', length: 500 })
  searchTerm: string;

  @Column({
    type: 'enum',
    enum: SearchType,
    default: SearchType.GENERAL,
  })
  searchType: SearchType;

  @Column({ type: 'int', default: 0 })
  resultCount: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  clickedResultId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

