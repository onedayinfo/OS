import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';

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
}
