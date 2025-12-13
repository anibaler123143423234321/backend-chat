import { IsString, IsEnum, IsOptional, IsInt, Min, MaxLength } from 'class-validator';
import { SearchType } from '../entities/recent-search.entity';

export class CreateRecentSearchDto {
  @IsString()
  @MaxLength(255)
  username: string;

  @IsString()
  @MaxLength(500)
  searchTerm: string;

  @IsEnum(SearchType)
  @IsOptional()
  searchType?: SearchType;

  @IsInt()
  @Min(0)
  @IsOptional()
  resultCount?: number;

  @IsString()
  @IsOptional()
  clickedResultId?: string;
}

