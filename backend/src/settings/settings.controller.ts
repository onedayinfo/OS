import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Put,
} from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { StorageService } from '../storage/storage.service.js';
import { isEncryptionKeySet } from './crypto.util.js';
import { SETTING_KEYS } from './settings.keys.js';
import { SettingsService } from './settings.service.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';

const KNOWN = new Set<string>(SETTING_KEYS);

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
}
