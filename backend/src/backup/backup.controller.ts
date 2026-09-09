import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../common/current-user.decorator.js';
import type { CurrentUserData } from '../common/current-user.decorator.js';
import { Roles } from '../common/roles.decorator.js';
import { StorageService } from '../storage/storage.service.js';
import type { UploadedFile as UF } from '../attachments/storage.util.js';
import { BackupService } from './backup.service.js';
import { ImportBackupDto } from './dto/import-backup.dto.js';

@Controller('backup')
@Roles('ADMIN')
export class BackupController {
  private readonly logger = new Logger(BackupController.name);

  constructor(
    private readonly backup: BackupService,
    private readonly storage: StorageService,
  ) {}

  @Get('export')
  async export(@Res() res: Response) {
    const file = await this.backup.export();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="os-backup-${stamp}.json"`);
    res.send(JSON.stringify(file, null, 2));
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  async import(
    @UploadedFile() file: UF,
    @Body() dto: ImportBackupDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    if (dto.confirm !== 'RESTAURAR') {
      throw new BadRequestException('Digite RESTAURAR para confirmar a restauração total.');
    }
    if (!file) throw new BadRequestException('Envie o arquivo de backup.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.buffer.toString('utf8'));
    } catch {
      throw new BadRequestException('Arquivo não é um JSON válido.');
    }
    this.logger.warn(`Restauração total disparada pelo usuário ${actor.id}`);
    await this.backup.import(parsed as never);
    return { ok: true };
  }

  @Get('list')
  async list() {
    const names = await this.storage.list('backups/');
    return names
      .sort()
      .reverse()
      .map((name) => ({ name }));
  }
}
