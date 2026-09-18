import { IsISO8601 } from 'class-validator';

export class LaborDto {
  @IsISO8601() laborStartAt!: string;
  @IsISO8601() laborEndAt!: string;
}
