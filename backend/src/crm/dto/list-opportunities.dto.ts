import { IsIn, IsOptional, IsString } from 'class-validator';

const STAGES = ['NEW', 'CONTACTED', 'PROPOSAL', 'WON', 'LOST'] as const;

export class ListOpportunitiesDto {
  @IsOptional() @IsIn(STAGES) stage?: (typeof STAGES)[number];
  @IsOptional() @IsString() ownerId?: string;
  @IsOptional() @IsString() clientId?: string;
}
