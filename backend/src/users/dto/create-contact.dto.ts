import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateContactDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  email!: string;

  @IsIn(['MANAGER', 'CONTACT'])
  role!: 'MANAGER' | 'CONTACT';

  @IsOptional()
  @IsString()
  phone?: string;
}
