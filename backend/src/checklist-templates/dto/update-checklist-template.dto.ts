import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ChecklistItemInput } from './checklist-item.dto.js';

export class UpdateChecklistTemplateDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  // Só adiciona/renomeia itens (sem `id` = novo). Nunca remove — um item já
  // respondido numa visita não pode sumir (spec §3.2).
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ChecklistItemInput)
  items?: ChecklistItemInput[];
}
