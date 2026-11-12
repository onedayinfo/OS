import { IsBoolean, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class CreateIntegrationDto {
  @IsString() @MinLength(1) @MaxLength(120)
  name!: string;

  @IsString()
  clientId!: string;

  @IsOptional() @IsString()
  categoryId?: string;
}

export class UpdateIntegrationDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120)
  name?: string;

  @IsOptional() @IsBoolean()
  active?: boolean;

  /** `null` remove a categoria padrão. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  categoryId?: string | null;
}
