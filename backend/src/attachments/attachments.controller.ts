import { pipeline } from 'node:stream/promises';
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../common/current-user.decorator.js';
import { Roles } from '../common/roles.decorator.js';
import type { CurrentUserData } from '../common/current-user.decorator.js';
import { AttachmentsService } from './attachments.service.js';
import { MulterExceptionFilter } from './multer-exception.filter.js';
import { MAX_ATTACHMENT_BYTES, type UploadedFile as UF } from './storage.util.js';

const interceptor = FileInterceptor('file', {
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
});

@Controller()
@UseFilters(MulterExceptionFilter)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  // Sem @Roles: qualquer autenticado; o acesso ao chamado é checado no service.
  @Post('tickets/:id/attachments')
  @UseInterceptors(interceptor)
  uploadToTicket(
    @Param('id') id: string,
    @UploadedFile() file: UF,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.attachments.saveForTicket(id, file, actor);
  }

  @Post('comments/:id/attachments')
  @UseInterceptors(interceptor)
  uploadToComment(
    @Param('id') id: string,
    @UploadedFile() file: UF,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.attachments.saveForComment(id, file, actor);
  }

  // Fotos de ativo: recurso interno. O acesso é checado pelo @Roles.
  @Post('assets/:id/attachments')
  @Roles('ADMIN', 'AGENT')
  @UseInterceptors(interceptor)
  uploadToAsset(
    @Param('id') id: string,
    @UploadedFile() file: UF,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.attachments.saveForAsset(id, file, actor);
  }

  @Get('assets/:id/attachments')
  @Roles('ADMIN', 'AGENT')
  listForAsset(@Param('id') id: string) {
    return this.attachments.listForAsset(id);
  }

  // Fotos/assinatura de visita: recurso interno. O acesso é checado pelo @Roles.
  @Post('visits/:id/attachments')
  @Roles('ADMIN', 'AGENT')
  @UseInterceptors(interceptor)
  uploadToVisit(
    @Param('id') id: string,
    @Query('kind') kind: 'PHOTO_BEFORE' | 'PHOTO_AFTER' | 'SIGNATURE',
    @UploadedFile() file: UF,
    @CurrentUser() actor: CurrentUserData,
  ) {
    if (!['PHOTO_BEFORE', 'PHOTO_AFTER', 'SIGNATURE'].includes(kind)) {
      throw new BadRequestException('kind inválido — use PHOTO_BEFORE, PHOTO_AFTER ou SIGNATURE.');
    }
    return this.attachments.saveForVisit(id, file, actor, kind);
  }

  @Get('visits/:id/attachments')
  @Roles('ADMIN', 'AGENT')
  listForVisit(@Param('id') id: string) {
    return this.attachments.listForVisit(id);
  }

  // Anexo de artigo da base de conhecimento: recurso interno. O acesso é checado pelo @Roles.
  @Post('knowledge-articles/:id/attachments')
  @Roles('ADMIN', 'AGENT')
  @UseInterceptors(interceptor)
  uploadToArticle(
    @Param('id') id: string,
    @UploadedFile() file: UF,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.attachments.saveForArticle(id, file, actor);
  }

  @Get('knowledge-articles/:id/attachments')
  @Roles('ADMIN', 'AGENT')
  listForArticle(@Param('id') id: string) {
    return this.attachments.listForArticle(id);
  }

  @Get('attachments/:id')
  async download(
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserData,
    @Res() res: Response,
  ) {
    const attachment = await this.attachments.getForDownload(id, actor);
    let obj;
    try {
      obj = await this.attachments.readable(attachment.storedPath);
    } catch {
      throw new NotFoundException('Arquivo não encontrado no armazenamento.');
    }
    res.type(attachment.mime);
    // RFC 5987: nome ASCII sanitizado + filename* em UTF-8 percent-encoded.
    const ascii = attachment.filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
    );
    await pipeline(obj.stream, res);
  }
}
