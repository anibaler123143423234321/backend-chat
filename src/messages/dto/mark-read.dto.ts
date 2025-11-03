import { IsString, IsArray, IsOptional } from 'class-validator';

export class MarkReadDto {
  @IsString()
  username: string; // Usuario que está leyendo el mensaje

  @IsArray()
  @IsOptional()
  messageIds?: number[]; // IDs de los mensajes a marcar como leídos
}

