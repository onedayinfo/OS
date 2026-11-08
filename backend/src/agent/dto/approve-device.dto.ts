import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ApproveDeviceDto {
  @IsString() @MinLength(1) locationId!: string;
  @IsString() @MinLength(1) typeId!: string;
  @IsString() @MinLength(1) label!: string;
  @IsOptional() @IsString() @MaxLength(200) assignedTo?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() notes?: string;
}
