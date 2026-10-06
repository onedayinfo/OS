import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import type {
  TicketPriority,
  TicketStatus,
} from '@prisma/client';
import { PaginationDto } from '../../common/pagination.dto.js';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'RESOLVED', 'CLOSED', 'CANCELLED'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export class ListTicketsDto extends PaginationDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: TicketStatus;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: TicketPriority;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  overdue?: boolean;

  // Só chamados não terminais (aberto, em andamento, aguardando cliente).
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  active?: boolean;

  // Fila de triagem (chamados de e-mail sem cliente).
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  needsTriage?: boolean;
}
