import { IsNumber, IsPositive, IsString, MinLength } from 'class-validator';

export class CreateMaterialUsageDto {
  @IsString() @MinLength(1) catalogItemId!: string;
  @IsString() @MinLength(1) warehouseId!: string;
  @IsNumber() @IsPositive() quantity!: number;
}
