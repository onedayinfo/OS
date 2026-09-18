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
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ContractSlaItemInput } from './contract-sla-item.dto.js';

export class CreateContractDto {
  @IsString() @MinLength(1) clientId!: string;
  @IsString() @MinLength(1) name!: string;
  @IsISO8601() startDate!: string;
  @IsISO8601() endDate!: string;
  @IsOptional() @IsNumber() monthlyValue?: number;
  @IsIn(['VISITS', 'HOURS']) franchiseUnit!: 'VISITS' | 'HOURS';
  @IsInt() @Min(1) franchiseAmount!: number;
  @IsOptional() @IsInt() @Min(1) preventiveFrequencyMonths?: number;
  @IsOptional() @IsString() defaultCategoryId?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) locationIds?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) assetIds?: string[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ContractSlaItemInput)
  slaOverrides?: ContractSlaItemInput[];
}
