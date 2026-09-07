import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsIn(['ADMIN', 'AGENT', 'MANAGER', 'CONTACT'])
  role?: 'ADMIN' | 'AGENT' | 'MANAGER' | 'CONTACT';

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
