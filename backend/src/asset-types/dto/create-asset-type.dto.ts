import { IsString, MinLength } from 'class-validator';

export class CreateAssetTypeDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
