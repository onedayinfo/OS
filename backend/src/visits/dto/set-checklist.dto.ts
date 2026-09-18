import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';

export class ChecklistAnswerInput {
  @IsString() @MinLength(1) itemId!: string;
  @IsBoolean() done!: boolean;
  @IsOptional() @IsString() note?: string;
}

export class SetChecklistDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ChecklistAnswerInput)
  answers!: ChecklistAnswerInput[];
}
