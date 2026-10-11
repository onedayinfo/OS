import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { TicketPriority } from '@prisma/client';

export class CreatePhraseDto {
  /** Ausente = frase do padrão global. */
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsString()
  @MinLength(1)
  phrase!: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: TicketPriority;

  @IsOptional()
  @IsString()
  title?: string;
}

export class UpdatePhraseDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  phrase?: string;

  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: TicketPriority;

  @IsOptional()
  @IsString()
  title?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ApplyDefaultsDto {
  @IsString()
  @MinLength(1)
  clientId!: string;
}
