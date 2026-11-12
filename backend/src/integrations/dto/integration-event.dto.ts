import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Contrato do `POST /api/integrations/events`. Campos extras são descartados. */
export class IntegrationEventDto {
  @IsString() @MinLength(1) @MaxLength(200)
  title!: string;

  @IsOptional() @IsString() @MaxLength(10000)
  description?: string;

  @IsOptional() @IsIn(['low', 'medium', 'high', 'urgent'])
  severity?: 'low' | 'medium' | 'high' | 'urgent';

  @IsOptional() @IsString() @MaxLength(200)
  externalId?: string;

  @IsOptional() @IsString() @MaxLength(200)
  assetSerial?: string;
}
