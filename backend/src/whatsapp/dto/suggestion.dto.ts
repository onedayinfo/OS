import { IsOptional, IsString } from 'class-validator';

export class AcceptSuggestionDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;
}
