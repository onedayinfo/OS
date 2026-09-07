import { IsIn, IsOptional, IsString } from 'class-validator';
import type { TicketPriority, TicketStatus } from '@prisma/client';

export class ChangeStatusDto {
  @IsIn(['OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'RESOLVED', 'CLOSED', 'CANCELLED'])
  status!: TicketStatus;
}

export class AssignDto {
  // `null` desatribui.
  @IsOptional()
  @IsString()
  assigneeId!: string | null;
}

export class ChangePriorityDto {
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority!: TicketPriority;
}

export class TriageDto {
  @IsString()
  clientId!: string;

  @IsString()
  requesterId!: string;
}
