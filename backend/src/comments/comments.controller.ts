import { Body, Controller, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator.js';
import type { CurrentUserData } from '../common/current-user.decorator.js';
import { CommentsService } from './comments.service.js';
import { CreateCommentDto } from './dto/create-comment.dto.js';

@Controller('tickets/:id/comments')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  // Sem @Roles: qualquer autenticado; o acesso ao chamado é checado no service.
  @Post()
  create(
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.comments.create(id, dto, actor);
  }
}
