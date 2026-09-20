import { IsBooleanString, IsIn, IsOptional } from 'class-validator';

export class ListCatalogItemsDto {
  @IsOptional() @IsIn(['SERVICE', 'PRODUCT']) type?: 'SERVICE' | 'PRODUCT';
  @IsOptional() @IsBooleanString() active?: string;
}
