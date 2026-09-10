import { IsArray, IsOptional, IsString } from 'class-validator';

export class SetTicketAssetsDto {
  // `null` limpa o local (e força assetIds vazio).
  @IsOptional()
  @IsString()
  locationId!: string | null;

  @IsArray()
  @IsString({ each: true })
  assetIds!: string[];
}
