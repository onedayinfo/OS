import { IsEmail, IsISO8601, IsNumber, IsOptional, IsString, ValidateIf } from 'class-validator';

export class UpdateOpportunityDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsNumber() value?: number;
  @IsOptional() @IsString() ownerId?: string;
  @IsOptional() @IsString() leadName?: string;
  @IsOptional() @IsString() leadCompany?: string;
  @IsOptional() @IsString() leadPhone?: string;
  @IsOptional() @IsEmail() leadEmail?: string;
  // null = desvincular o orçamento.
  @IsOptional() @ValidateIf((o) => o.quoteId !== null) @IsString()
  quoteId?: string | null;
  // null = limpar o follow-up agendado.
  @IsOptional() @ValidateIf((o) => o.nextFollowUpAt !== null) @IsISO8601()
  nextFollowUpAt?: string | null;
  @IsOptional() @ValidateIf((o) => o.nextFollowUpNote !== null) @IsString()
  nextFollowUpNote?: string | null;
}
