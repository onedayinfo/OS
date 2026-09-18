import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class UpdateVisitDto {
  @IsOptional() @IsString() technicianId?: string;
  @IsOptional() @IsISO8601() scheduledStart?: string;
  @IsOptional() @IsISO8601() scheduledEnd?: string;
}
