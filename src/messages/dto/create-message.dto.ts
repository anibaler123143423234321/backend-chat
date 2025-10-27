import {
  IsString,
  IsBoolean,
  IsOptional,
  IsNumber,
  IsDateString,
} from 'class-validator';

export class CreateMessageDto {
  @IsString()
  from: string;

  @IsNumber()
  @IsOptional()
  fromId?: number;

  @IsString()
  @IsOptional()
  to?: string;

  @IsString()
  @IsOptional()
  message?: string;

  @IsBoolean()
  @IsOptional()
  isGroup?: boolean;

  @IsString()
  @IsOptional()
  groupName?: string;

  @IsString()
  @IsOptional()
  roomCode?: string;

  @IsString()
  @IsOptional()
  mediaType?: string;

  @IsString()
  @IsOptional()
  mediaData?: string;

  @IsString()
  @IsOptional()
  fileName?: string;

  @IsNumber()
  @IsOptional()
  fileSize?: number;

  @IsDateString()
  @IsOptional()
  sentAt?: Date;

  @IsString()
  @IsOptional()
  time?: string;

  @IsNumber()
  @IsOptional()
  roomId?: number;

  @IsNumber()
  @IsOptional()
  replyToMessageId?: number;

  @IsString()
  @IsOptional()
  replyToSender?: string;

  @IsString()
  @IsOptional()
  replyToText?: string;
}
