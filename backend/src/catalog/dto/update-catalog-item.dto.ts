import { IsBoolean, IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

export class UpdateCatalogItemDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() @MinLength(1) unit?: string;
  @IsOptional() @IsNumber() @IsPositive() price?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
