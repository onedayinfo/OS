import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { isEncryptionKeySet } from './crypto.util.js';
import { SETTING_KEYS } from './settings.keys.js';
import { SettingsService } from './settings.service.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';

const KNOWN = new Set<string>(SETTING_KEYS);

@Controller('settings')
@Roles('ADMIN')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

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
}
