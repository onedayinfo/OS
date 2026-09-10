import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateLocationDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsString() accessNotes?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
