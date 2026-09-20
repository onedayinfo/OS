import { IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

export class CreateStockEntryDto {
  @IsString() @MinLength(1) catalogItemId!: string;
  @IsString() @MinLength(1) warehouseId!: string;
  @IsNumber() @IsPositive() quantity!: number;
  @IsNumber() @IsPositive() unitCost!: number;
  @IsOptional() @IsString() notes?: string;
}
