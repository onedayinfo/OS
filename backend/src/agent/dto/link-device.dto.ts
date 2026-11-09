import { IsString, MinLength } from 'class-validator';

export class LinkDeviceDto {
  @IsString() @MinLength(1) assetId!: string;
}
