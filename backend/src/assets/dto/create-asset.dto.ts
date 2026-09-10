import { Type } from 'class-transformer';
import {
  IsIn, IsISO8601, IsOptional, IsString, MinLength, ValidateNested,
} from 'class-validator';

export class CredentialsDto {
  @IsString() @MinLength(1) username!: string;
  @IsString() @MinLength(1) password!: string;
}

export class CreateAssetDto {
  @IsString() @MinLength(1) clientId!: string;
  @IsString() @MinLength(1) locationId!: string;
  @IsString() @MinLength(1) typeId!: string;
  @IsString() @MinLength(1) label!: string;

  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsString() ip?: string;
  @IsOptional() @IsString() mac?: string;

  // `null` limpa; objeto grava; ausência mantém (no update).
  @IsOptional() @ValidateNested() @Type(() => CredentialsDto)
  credentials?: CredentialsDto | null;

  @IsOptional() @IsISO8601() installedAt?: string;
  @IsOptional() @IsISO8601() warrantyEndsAt?: string;

  @IsOptional() @IsIn(['ACTIVE', 'MAINTENANCE', 'INACTIVE']) status?: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';
  @IsOptional() @IsString() notes?: string;
}
