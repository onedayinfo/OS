import { IsBooleanString, IsOptional, IsString } from 'class-validator';

export class ListStockBalancesDto {
  @IsOptional() @IsString() warehouseId?: string;
  @IsOptional() @IsString() catalogItemId?: string;
  @IsOptional() @IsBooleanString() belowMinimum?: string;
}
