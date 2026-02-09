import { IsString, IsArray, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MarkReadDto {
  @ApiProperty({ description: 'Usuario que está leyendo el mensaje' })
  @IsString()
  username: string;

  @ApiProperty({ description: 'IDs de los mensajes a marcar como leídos', type: [Number], required: false })
  @IsArray()
  @IsOptional()
  messageIds?: number[];
}

