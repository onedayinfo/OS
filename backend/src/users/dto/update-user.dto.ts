import { IsBoolean, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  phone?: string;

  /** `null` remove o grupo (volta a admin pleno). */
  @ValidateIf((_o, v) => v !== null)
  @IsOptional()
  @IsString()
  groupId?: string | null;
}
