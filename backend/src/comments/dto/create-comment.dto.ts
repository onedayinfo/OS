import { IsIn, IsString, MinLength } from 'class-validator';
import type { CommentVisibility } from '@prisma/client';

export class CreateCommentDto {
  @IsString()
  @MinLength(1)
  body!: string;

  @IsIn(['INTERNAL', 'PUBLIC'])
  visibility!: CommentVisibility;
}
