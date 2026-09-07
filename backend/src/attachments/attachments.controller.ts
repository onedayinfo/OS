import { resolve } from 'node:path';
import {
  Controller,
  Get,
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
    // res.download faz o encoding RFC 5987 do nome (filename*=UTF-8'') e o
    // fallback ASCII — sem spoof por aspas nem ERR_INVALID_CHAR em acento.
    res.type(attachment.mime);
    await new Promise<void>((ok, fail) =>
      res.download(resolve(attachment.storedPath), attachment.filename, (err) =>
        err ? fail(err) : ok(),
      ),
    );
  }
}
