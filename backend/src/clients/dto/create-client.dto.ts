import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateClientDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  cnpj?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  emailDomains?: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}
