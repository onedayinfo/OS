import { IsEmail, IsISO8601, IsNumber, IsOptional, IsString, ValidateIf } from 'class-validator';

export class UpdateOpportunityDto {
  @IsOptional() @IsString() title?: string;
  // null = limpar o valor estimado.
  @IsOptional() @ValidateIf((o) => o.value !== null) @IsNumber()
  value?: number | null;
  @IsOptional() @IsString() ownerId?: string;
  @IsOptional() @IsString() leadName?: string;
  // null = limpar o campo.
  @IsOptional() @ValidateIf((o) => o.leadCompany !== null) @IsString()
  leadCompany?: string | null;
  @IsOptional() @ValidateIf((o) => o.leadPhone !== null) @IsString()
  leadPhone?: string | null;
  @IsOptional() @ValidateIf((o) => o.leadEmail !== null) @IsEmail()
  leadEmail?: string | null;
  // null = desvincular o orçamento.
  @IsOptional() @ValidateIf((o) => o.quoteId !== null) @IsString()
  quoteId?: string | null;
  // null = limpar o follow-up agendado.
  @IsOptional() @ValidateIf((o) => o.nextFollowUpAt !== null) @IsISO8601()
  nextFollowUpAt?: string | null;
  @IsOptional() @ValidateIf((o) => o.nextFollowUpNote !== null) @IsString()
  nextFollowUpNote?: string | null;
}
