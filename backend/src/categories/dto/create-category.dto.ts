import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { CategorySlaItemInput } from './category-sla-item.dto.js';

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CategorySlaItemInput)
  slaOverrides?: CategorySlaItemInput[];
}
