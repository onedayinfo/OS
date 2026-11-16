import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { TicketPriority } from '@prisma/client';

export class CreateIntegrationDto {
  @IsString() @MinLength(1) @MaxLength(120)
  name!: string;

  @IsString()
  clientId!: string;

  @IsOptional() @IsString()
  categoryId?: string;
}

/** Modelos `{{caminho}}` por campo do chamado (construtor de eventos). */
export class IntegrationMappingDto {
  @IsString() @MinLength(1) @MaxLength(500)
  title!: string;

  @IsOptional() @IsString() @MaxLength(5000)
  description?: string;

  @IsOptional() @IsString() @MaxLength(500)
  externalId?: string;

  @IsOptional() @IsString() @MaxLength(500)
  assetSerial?: string;

  @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: TicketPriority;
}

export class UpdateIntegrationDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120)
  name?: string;

  @IsOptional() @IsBoolean()
  active?: boolean;

  /** `null` remove a categoria padrão. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  categoryId?: string | null;

  /** `null` remove o mapeamento. */
  @IsOptional() @ValidateNested() @Type(() => IntegrationMappingDto)
  mapping?: IntegrationMappingDto | null;
}
