import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../common/pagination.dto.js';

export class ListAssetsDto extends PaginationDto {
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() typeId?: string;
  @IsOptional() @IsIn(['ACTIVE', 'MAINTENANCE', 'INACTIVE']) status?: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';
}
