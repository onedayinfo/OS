import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../common/pagination.dto.js';

export class ListDevicesDto extends PaginationDto {
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsIn(['PENDING', 'LINKED', 'IGNORED']) status?: 'PENDING' | 'LINKED' | 'IGNORED';
}
