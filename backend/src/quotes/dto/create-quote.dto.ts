import { Type } from 'class-transformer';
import { IsArray, IsISO8601, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { QuoteItemInput } from './quote-item.dto.js';

export class CreateQuoteDto {
  @IsString() @MinLength(1) clientId!: string;
  @IsOptional() @IsString() ticketId?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsISO8601() validUntil?: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => QuoteItemInput)
  items!: QuoteItemInput[];
}
