import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../common/roles.decorator.js';
import { StorageService } from '../storage/storage.service.js';
import type { UploadedFile as UF } from '../attachments/storage.util.js';
import { isEncryptionKeySet } from './crypto.util.js';
import { SETTING_KEYS } from './settings.keys.js';
import { SettingsService } from './settings.service.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';

const KNOWN = new Set<string>(SETTING_KEYS);
const LOGO_MAX = 512 * 1024;
const LOGO_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
]);

@Controller('settings')
@Roles('ADMIN')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async get() {
    return { ...(await this.settings.describe()), encryptionKeySet: isEncryptionKeySet() };
  }

  @Put()
  async update(@Body() dto: UpdateSettingsDto) {
    const entries = Object.entries(dto.values ?? {});
    for (const [key] of entries) {
      if (!KNOWN.has(key)) throw new BadRequestException(`Configuração desconhecida: ${key}.`);
    }
    for (const [key, value] of entries) {
      await this.settings.set(key, String(value ?? ''));
    }
    return { ...(await this.settings.describe()), encryptionKeySet: isEncryptionKeySet() };
  }

  @Post('storage/test')
  async testStorage() {
    try {
      await this.storage.testConnection();
      return { ok: true };
    } catch (err) {
      throw new HttpException(
        `Falha ao acessar o armazenamento: ${(err as Error).message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  @Post('branding/logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_MAX } }))
  async uploadLogo(@UploadedFile() file: UF) {
    if (!file) throw new BadRequestException('Arquivo ausente.');
    if (!LOGO_MIMES.has(file.mimetype)) {
      throw new BadRequestException(`Tipo de imagem não permitido: ${file.mimetype}.`);
    }
    if (file.size > LOGO_MAX) throw new BadRequestException('Logo excede 512 KB.');
    await this.settings.set('branding.logoData', file.buffer.toString('base64'));
    await this.settings.set('branding.logoMime', file.mimetype);
    return { ok: true };
  }

  @Delete('branding/logo')
  async deleteLogo() {
    await this.settings.unset('branding.logoData');
    await this.settings.unset('branding.logoMime');
    return { ok: true };
  }
}
