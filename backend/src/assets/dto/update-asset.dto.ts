import { Type } from 'class-transformer';
import {
  IsIn, IsISO8601, IsOptional, IsString, MinLength, ValidateNested,
} from 'class-validator';
import { CredentialsDto } from './create-asset.dto.js';

// `@nestjs/mapped-types` não está instalado: repetimos os campos do
// `CreateAssetDto` à mão, todos como `@IsOptional()` (inclusive
// `clientId`/`locationId`/`typeId`/`label`).
export class UpdateAssetDto {
  @IsOptional() @IsString() @MinLength(1) clientId?: string;
  @IsOptional() @IsString() @MinLength(1) locationId?: string;
  @IsOptional() @IsString() @MinLength(1) typeId?: string;
  @IsOptional() @IsString() @MinLength(1) label?: string;

  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsString() ip?: string;
  @IsOptional() @IsString() mac?: string;

  // `null` limpa; objeto grava; ausência mantém.
  @IsOptional() @ValidateNested() @Type(() => CredentialsDto)
  credentials?: CredentialsDto | null;

  @IsOptional() @IsISO8601() installedAt?: string;
  @IsOptional() @IsISO8601() warrantyEndsAt?: string;

  @IsOptional() @IsIn(['ACTIVE', 'MAINTENANCE', 'INACTIVE']) status?: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';
  @IsOptional() @IsString() notes?: string;
}
