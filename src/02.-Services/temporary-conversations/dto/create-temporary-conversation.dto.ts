import { IsString, IsOptional, IsNumber, IsDateString, IsArray, IsObject } from 'class-validator';

export class CreateTemporaryConversationDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  durationHours: number;

  @IsOptional()
  @IsNumber()
  maxParticipants?: number;

  @IsOptional()
  @IsArray()
  participants?: string[];

  @IsOptional()
  @IsObject()
  settings?: any;
}
