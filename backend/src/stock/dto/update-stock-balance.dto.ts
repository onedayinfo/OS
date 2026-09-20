import { IsNumber, IsOptional, ValidateIf } from 'class-validator';

export class UpdateStockBalanceDto {
  // null = remove o mínimo (sem alerta).
  @ValidateIf((o) => o.minQuantity !== null) @IsOptional() @IsNumber()
  minQuantity!: number | null;
}
