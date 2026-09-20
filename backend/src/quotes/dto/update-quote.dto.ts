import { Type } from 'class-transformer';
import { IsArray, IsISO8601, IsOptional, IsString, ValidateNested } from 'class-validator';
import { QuoteItemInput } from './quote-item.dto.js';

export class UpdateQuoteDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsISO8601() validUntil?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => QuoteItemInput)
  items?: QuoteItemInput[];
}
