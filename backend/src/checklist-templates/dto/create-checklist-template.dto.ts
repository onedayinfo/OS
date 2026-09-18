import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { ChecklistItemInput } from './checklist-item.dto.js';

export class CreateChecklistTemplateDto {
  @IsOptional() @IsString() categoryId?: string;
  @IsString() @MinLength(1) name!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ChecklistItemInput)
  items!: ChecklistItemInput[];
}
