import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateAssetTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
