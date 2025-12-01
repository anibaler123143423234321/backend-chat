import {
  IsString,
  IsBoolean,
  IsOptional,
  IsNumber,
  IsDateString,
} from 'class-validator';

export class CreateMessageDto {
  @IsString()
  @IsOptional()
  id?: string; // 🔥 NUEVO: ID del mensaje para detección de duplicados

  @IsNumber()
  @IsOptional()
  conversationId?: number; // 🔥 NUEVO: ID de la conversación asignada

  @IsString()
  from: string;

  @IsNumber()
  @IsOptional()
  fromId?: number;

  @IsString()
  @IsOptional()
  senderRole?: string;

  @IsString()
  @IsOptional()
  senderNumeroAgente?: string;

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

  @IsString()
  @IsOptional()
  replyToSenderNumeroAgente?: string;

  @IsNumber()
  @IsOptional()
  threadId?: number;

  @IsNumber()
  @IsOptional()
  threadCount?: number;

  // 🔥 NUEVO: Campos para videollamadas
  @IsString()
  @IsOptional()
  type?: string;

  @IsString()
  @IsOptional()
  videoCallUrl?: string;

  @IsString()
  @IsOptional()
  videoRoomID?: string;

  @IsOptional()
  metadata?: any;

  // 🔥 Campo para mensajes reenviados
  @IsBoolean()
  @IsOptional()
  isForwarded?: boolean;
}
