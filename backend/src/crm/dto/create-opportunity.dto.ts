import { IsEmail, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateOpportunityDto {
  @IsString() @MinLength(1) title!: string;
  @IsOptional() @IsNumber() value?: number;
  @IsString() @MinLength(1) ownerId!: string;
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() leadName?: string;
  @IsOptional() @IsString() leadCompany?: string;
  @IsOptional() @IsString() leadPhone?: string;
  @IsOptional() @IsEmail() leadEmail?: string;
  @IsOptional() @IsString() quoteId?: string;
}
