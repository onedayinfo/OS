import { IsNumber, IsOptional } from 'class-validator';

export class GeoDto {
  @IsOptional() @IsNumber() lat?: number;
  @IsOptional() @IsNumber() lng?: number;
}
