import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateArticleDto {
  @IsString() @MinLength(1) title!: string;
  @IsString() @MinLength(1) body!: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() assetTypeId?: string;
}
