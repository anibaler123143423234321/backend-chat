import {
  IsString,
  IsBoolean,
  IsOptional,
  IsNumber,
  IsDateString,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAttachmentDto {
  @ApiProperty({ description: 'URL del archivo adjunto' })
  @IsString()
  url: string;

  @ApiProperty({ description: 'Tipo de archivo (image, video, file)', required: false })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiProperty({ description: 'Nombre del archivo', required: false })
  @IsString()
  @IsOptional()
  fileName?: string;

  @ApiProperty({ description: 'Tamaño del archivo en bytes', required: false })
  @IsNumber()
  @IsOptional()
  fileSize?: number;
}

export class CreateMessageDto {
  @ApiProperty({ description: 'ID único del mensaje para detección de duplicados', required: false })
  @IsString()
  @IsOptional()
  id?: string;

  @ApiProperty({ description: 'ID de la conversación asignada', required: false })
  @IsNumber()
  @IsOptional()
  conversationId?: number;

  @ApiProperty({ description: 'ID o username del remitente' })
  @IsString()
  from: string;

  @ApiProperty({ description: 'ID numérico del remitente', required: false })
  @IsNumber()
  @IsOptional()
  fromId?: number;

  @ApiProperty({ description: 'Rol del remitente', required: false })
  @IsString()
  @IsOptional()
  senderRole?: string;

  @ApiProperty({ description: 'Número de agente del remitente', required: false })
  @IsString()
  @IsOptional()
  senderNumeroAgente?: string;

  @ApiProperty({ description: 'ID o username del destinatario', required: false })
  @IsString()
  @IsOptional()
  to?: string;

  @ApiProperty({ description: 'Contenido del mensaje', required: false })
  @IsString()
  @IsOptional()
  message?: string;

  @ApiProperty({ description: 'Indica si es un mensaje de grupo', required: false })
  @IsBoolean()
  @IsOptional()
  isGroup?: boolean;

  @ApiProperty({ description: 'Nombre del grupo', required: false })
  @IsString()
  @IsOptional()
  groupName?: string;

  @ApiProperty({ description: 'Código de la sala (room)', required: false })
  @IsString()
  @IsOptional()
  roomCode?: string;

  @ApiProperty({ description: 'Tipo de medio (image, video, etc)', required: false })
  @IsString()
  @IsOptional()
  mediaType?: string;

  @ApiProperty({ description: 'Datos del medio o URL', required: false })
  @IsString()
  @IsOptional()
  mediaData?: string;

  @ApiProperty({ description: 'Nombre del archivo adjunto principal', required: false })
  @IsString()
  @IsOptional()
  fileName?: string;

  @ApiProperty({ description: 'Tamaño del archivo adjunto principal', required: false })
  @IsNumber()
  @IsOptional()
  fileSize?: number;

  @ApiProperty({ description: 'Fecha de envío', required: false })
  @IsDateString()
  @IsOptional()
  sentAt?: Date;

  @ApiProperty({ description: 'Hora de envío formateada', required: false })
  @IsString()
  @IsOptional()
  time?: string;

  @ApiProperty({ description: 'ID de la sala', required: false })
  @IsNumber()
  @IsOptional()
  roomId?: number;

  @ApiProperty({ description: 'ID del mensaje al que responde', required: false })
  @IsNumber()
  @IsOptional()
  replyToMessageId?: number;

  @ApiProperty({ description: 'Remitente del mensaje original al que se responde', required: false })
  @IsString()
  @IsOptional()
  replyToSender?: string;

  @ApiProperty({ description: 'Texto del mensaje original al que se responde', required: false })
  @IsString()
  @IsOptional()
  replyToText?: string;

  @ApiProperty({ description: 'Número de agente del remitente original', required: false })
  @IsString()
  @IsOptional()
  replyToSenderNumeroAgente?: string;

  @ApiProperty({ description: 'ID del hilo de conversación', required: false })
  @IsNumber()
  @IsOptional()
  threadId?: number;

  @ApiProperty({ description: 'Contador de mensajes en el hilo', required: false })
  @IsNumber()
  @IsOptional()
  threadCount?: number;

  @ApiProperty({ description: 'Tipo de mensaje especial (e.g., videollamada)', required: false })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiProperty({ description: 'URL de la videollamada', required: false })
  @IsString()
  @IsOptional()
  videoCallUrl?: string;

  @ApiProperty({ description: 'ID de la sala de video', required: false })
  @IsString()
  @IsOptional()
  videoRoomID?: string;

  @ApiProperty({ description: 'Metadatos adicionales', required: false })
  @IsOptional()
  metadata?: any;

  @ApiProperty({ description: 'Indica si el mensaje ha sido reenviado', required: false })
  @IsBoolean()
  @IsOptional()
  isForwarded?: boolean;

  @ApiProperty({ description: 'ID del adjunto específico al que se responde', required: false })
  @IsNumber()
  @IsOptional()
  replyToAttachmentId?: number;

  @ApiProperty({ description: 'Lista de archivos adjuntos', type: [CreateAttachmentDto], required: false })
  @IsOptional()
  attachments?: CreateAttachmentDto[];
}

