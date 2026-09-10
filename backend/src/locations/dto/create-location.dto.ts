import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateLocationDto {
  @IsString()
  @MinLength(1)
  clientId!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsString() accessNotes?: string;
}
