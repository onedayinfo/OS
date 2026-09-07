import { IsInt, Min } from 'class-validator';

export class UpdateSlaDto {
  @IsInt()
  @Min(1)
  hours!: number;
}
