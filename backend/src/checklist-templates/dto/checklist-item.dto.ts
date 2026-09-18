import { IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class ChecklistItemInput {
  // presente = atualiza o item existente; ausente = cria um novo.
  @IsOptional() @IsString() id?: string;
  @IsString() @MinLength(1) label!: string;
  @IsOptional() @IsInt() order?: number;
}
