import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class EnrollDto {
  @Matches(/^[0-9a-f]{32}$/)
  code!: string;

  @IsString()
  @Length(1, 64)
  machineGuid!: string;

  @IsString()
  @Length(1, 255)
  hostname!: string;

  @IsOptional() @IsString() @MaxLength(255) serialNumber?: string;
  @IsOptional() @IsString() @MaxLength(255) manufacturer?: string;
  @IsOptional() @IsString() @MaxLength(255) model?: string;
  @IsOptional() @IsString() @MaxLength(64) ip?: string;
  @IsOptional() @IsString() @MaxLength(64) mac?: string;
  @IsOptional() @IsString() @MaxLength(64) agentVersion?: string;
}
