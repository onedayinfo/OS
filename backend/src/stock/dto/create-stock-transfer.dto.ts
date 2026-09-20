import { IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

export class CreateStockTransferDto {
  @IsString() @MinLength(1) catalogItemId!: string;
  @IsString() @MinLength(1) fromWarehouseId!: string;
  @IsString() @MinLength(1) toWarehouseId!: string;
  @IsNumber() @IsPositive() quantity!: number;
  @IsOptional() @IsString() notes?: string;
}
