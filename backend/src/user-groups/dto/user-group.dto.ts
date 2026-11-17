import { ArrayUnique, IsArray, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { SCREENS, type ScreenKey } from '../screens.js';

export class UserGroupDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsArray()
  @ArrayUnique()
  @IsIn(SCREENS, { each: true })
  screens!: ScreenKey[];
}

// ponytail: sem @nestjs/mapped-types instalado; o parcial é escrito à mão
export class UpdateUserGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(SCREENS, { each: true })
  screens?: ScreenKey[];
}
