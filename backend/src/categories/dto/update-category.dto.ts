import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { CategorySlaItemInput } from './category-sla-item.dto.js';

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CategorySlaItemInput)
  slaOverrides?: CategorySlaItemInput[];
}
