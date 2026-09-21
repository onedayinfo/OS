import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class RespondSurveyDto {
  @IsInt() @Min(1) @Max(5) score!: number;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}
