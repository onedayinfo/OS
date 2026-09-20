import { IsString, MinLength } from 'class-validator';

export class CreateWarehouseDto {
  @IsString() @MinLength(1) name!: string;
}
