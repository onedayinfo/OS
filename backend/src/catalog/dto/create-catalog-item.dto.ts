import { IsIn, IsNumber, IsPositive, IsString, MinLength } from 'class-validator';

export class CreateCatalogItemDto {
  @IsString() @MinLength(1) name!: string;
  @IsIn(['SERVICE', 'PRODUCT']) type!: 'SERVICE' | 'PRODUCT';
  @IsString() @MinLength(1) unit!: string;
  @IsNumber() @IsPositive() price!: number;
}
