import { IsString, IsOptional, IsNumber, IsObject } from 'class-validator';

export class CreateTemporaryRoomDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  maxCapacity: number;

  @IsOptional()
  @IsObject()
  settings?: any;

  @IsOptional()
  @IsString()
  creatorUsername?: string;

  @IsOptional()
  @IsNumber()
  duration?: number; // Duración en minutos
}
