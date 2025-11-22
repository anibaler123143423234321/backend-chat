import { IsString, IsNotEmpty, IsArray, ArrayMinSize, ArrayMaxSize } from 'class-validator';

export class CreatePollDto {
    @IsString()
    @IsNotEmpty()
    question: string;

    @IsArray()
    @ArrayMinSize(2)
    @ArrayMaxSize(10)
    @IsString({ each: true })
    options: string[];
}
