import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsObject, IsOptional, IsString, Length, MaxLength, ValidateNested,
} from 'class-validator';

export class SoftwareItemDto {
  @IsString() @Length(1, 255) name!: string;
  @IsOptional() @IsString() @MaxLength(128) version?: string;
  @IsOptional() @IsString() @MaxLength(255) publisher?: string;
}

export class InventoryDto {
  @IsObject() specs!: Record<string, unknown>;

  @IsArray()
  @ArrayMaxSize(3000)
  @ValidateNested({ each: true })
  @Type(() => SoftwareItemDto)
  software!: SoftwareItemDto[];
}

export class CheckinDto {
  @IsString() @Length(1, 255) hostname!: string;
  @IsOptional() @IsString() @MaxLength(255) serialNumber?: string;
  @IsOptional() @IsString() @MaxLength(255) manufacturer?: string;
  @IsOptional() @IsString() @MaxLength(255) model?: string;
  @IsOptional() @IsString() @MaxLength(64) ip?: string;
  @IsOptional() @IsString() @MaxLength(64) mac?: string;
  @IsOptional() @IsString() @MaxLength(64) agentVersion?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => InventoryDto)
  inventory?: InventoryDto;
}
