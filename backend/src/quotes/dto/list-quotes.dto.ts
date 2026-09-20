import { IsIn, IsOptional, IsString } from 'class-validator';

const STATUSES = ['DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'SUPERSEDED'] as const;

export class ListQuotesDto {
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() ticketId?: string;
  @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
}
