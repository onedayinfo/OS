import { Type } from 'class-transformer';
import {
  IsArray,
  IsISO8601,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { ContractSlaItemInput } from './contract-sla-item.dto.js';
import { ValidateNested } from 'class-validator';

export class UpdateContractDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsISO8601() startDate?: string;
  @IsOptional() @IsISO8601() endDate?: string;
  @IsOptional() @IsNumber() monthlyValue?: number;
  @IsOptional() @IsIn(['VISITS', 'HOURS']) franchiseUnit?: 'VISITS' | 'HOURS';
  @IsOptional() @IsInt() @Min(1) franchiseAmount?: number;
  // null = desligar a geração automática de preventiva.
  @IsOptional() @ValidateIf((o) => o.preventiveFrequencyMonths !== null) @IsInt() @Min(1)
  preventiveFrequencyMonths?: number | null;
  @IsOptional() @IsString() defaultCategoryId?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) locationIds?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) assetIds?: string[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ContractSlaItemInput)
  slaOverrides?: ContractSlaItemInput[];
}
