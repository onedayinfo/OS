import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class RespondSurveyDto {
  @IsInt() @Min(1) @Max(5) score!: number;
  @IsOptional() @IsString() comment?: string;
}
