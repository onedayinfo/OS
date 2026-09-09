import { pipeline } from 'node:stream/promises';
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../common/current-user.decorator.js';
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
