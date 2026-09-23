import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateArticleDto {
  @IsOptional() @IsString() @MinLength(1) title?: string;
  @IsOptional() @IsString() @MinLength(1) body?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() assetTypeId?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
