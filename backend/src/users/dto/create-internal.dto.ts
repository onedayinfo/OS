import { IsEmail, IsIn, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class CreateInternalDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  email!: string;

  @IsIn(['ADMIN', 'AGENT'])
  role!: 'ADMIN' | 'AGENT';

  @IsString()
  @MinLength(8)
  password!: string;

  @ValidateIf((_o, v) => v !== null)
  @IsOptional()
  @IsString()
  groupId?: string | null;
}
