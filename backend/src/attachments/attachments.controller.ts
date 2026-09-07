import { resolve } from 'node:path';
import {
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../common/current-user.decorator.js';
import type { CurrentUserData } from '../common/current-user.decorator.js';
import { AttachmentsService } from './attachments.service.js';
import { MAX_ATTACHMENT_BYTES, type UploadedFile as UF } from './storage.util.js';

const interceptor = FileInterceptor('file', {
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
});

@Controller()
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
    res.set({
      'Content-Type': attachment.mime,
      'Content-Disposition': `attachment; filename="${attachment.filename}"`,
    });
    res.sendFile(resolve(attachment.storedPath));
  }
}
