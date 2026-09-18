import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListContractsDto {
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsIn(['ACTIVE', 'EXPIRED', 'CANCELLED']) status?: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
}
