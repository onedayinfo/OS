import { IsIn, IsInt, Min } from 'class-validator';
import type { TicketPriority } from '@prisma/client';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

export class CategorySlaItemInput {
  @IsIn(PRIORITIES) priority!: TicketPriority;
  @IsInt() @Min(1) hours!: number;
}
