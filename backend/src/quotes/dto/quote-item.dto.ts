import { IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

export class QuoteItemInput {
  @IsString() @MinLength(1) catalogItemId!: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() @IsPositive() quantity!: number;
  // Se ausente, o service usa o preço atual do CatalogItem no momento da criação.
  @IsOptional() @IsNumber() @IsPositive() unitPrice?: number;
}
