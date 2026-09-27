import { IsIn, IsOptional, IsString } from 'class-validator';

const STAGES = ['NEW', 'CONTACTED', 'PROPOSAL', 'WON', 'LOST'] as const;

export class ChangeStageDto {
  @IsIn(STAGES) stage!: (typeof STAGES)[number];
  @IsOptional() @IsString() lostReason?: string;
}
