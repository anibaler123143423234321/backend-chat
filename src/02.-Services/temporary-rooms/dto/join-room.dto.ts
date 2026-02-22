import { IsString, IsOptional } from 'class-validator';

export class JoinRoomDto {
  @IsString()
  roomCode: string;

  @IsString()
  @IsOptional()
  username?: string;
}
