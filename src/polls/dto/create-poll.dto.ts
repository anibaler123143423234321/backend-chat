import { IsString, IsNotEmpty, IsArray, ArrayMinSize, ArrayMaxSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePollDto {
    @ApiProperty({ description: 'Pregunta de la encuesta' })
    @IsString()
    @IsNotEmpty()
    question: string;

    @ApiProperty({ description: 'Opciones de la encuesta', type: [String] })
    @IsArray()
    @ArrayMinSize(2)
    @ArrayMaxSize(10)
    @IsString({ each: true })
    options: string[];
}
