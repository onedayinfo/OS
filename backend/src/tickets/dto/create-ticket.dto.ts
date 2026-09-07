import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { TicketPriority } from '@prisma/client';

export class CreateTicketDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  requesterId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: TicketPriority;

  @IsOptional()
  @IsString()
  equipment?: string;
}
