import { IsISO8601, IsString, MinLength } from 'class-validator';

export class CreateVisitDto {
  @IsString() @MinLength(1) ticketId!: string;
  @IsString() @MinLength(1) technicianId!: string;
  @IsISO8601() scheduledStart!: string;
  @IsISO8601() scheduledEnd!: string;
}
