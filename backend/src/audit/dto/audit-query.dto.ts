import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../common/pagination.dto.js';

/** Query de listagem de auditoria: filtros + paginação. */
export class AuditQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['ACTION', 'ERROR'])
  kind?: 'ACTION' | 'ERROR';

  @IsOptional()
  @IsString()
  actorId?: string;

  @IsOptional()
  @IsString()
  module?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
