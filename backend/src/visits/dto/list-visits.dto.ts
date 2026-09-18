import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

const STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;

export class ListVisitsDto {
  @IsOptional() @IsString() technicianId?: string;
  @IsOptional() @IsDateString() date?: string; // YYYY-MM-DD
  @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
  @IsOptional() @IsString() ticketId?: string;
}
