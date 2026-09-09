import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { decrypt, encrypt } from './crypto.util.js';
import { BULKY_KEYS, ENV_FALLBACK, SECRET_KEYS } from './settings.keys.js';

interface Row {
  value: string;
  encrypted: boolean;
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private cache: Map<string, Row> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async load(): Promise<Map<string, Row>> {
    if (this.cache) return this.cache;
    const rows = await this.prisma.setting.findMany();
    this.cache = new Map(rows.map((r) => [r.key, { value: r.value, encrypted: r.encrypted }]));
    return this.cache;
  }

  private invalidate(): void {
    this.cache = null;
  }

  async get(key: string): Promise<string | undefined> {
    const row = (await this.load()).get(key);
    if (row) {
      if (!row.encrypted) return row.value;
      try {
        return decrypt(row.value);
      } catch (err) {
        // Chave errada/ausente: não derruba o boot — cai pro fallback abaixo.
        this.logger.error(`Falha ao descriptografar "${key}": ${(err as Error).message}`);
      }
    }
    const env = ENV_FALLBACK[key];
    return env ? process.env[env] : undefined;
  }

  async getMany(keys: string[]): Promise<Record<string, string | undefined>> {
    const out: Record<string, string | undefined> = {};
    for (const k of keys) out[k] = await this.get(k);
    return out;
  }

  async getBool(key: string): Promise<boolean> {
    return (await this.get(key)) === 'true';
  }

  async getNumber(key: string): Promise<number | undefined> {
    const v = await this.get(key);
    if (v == null || v.trim() === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  async set(key: string, value: string, opts: { encrypt?: boolean } = {}): Promise<void> {
    const isSecret = SECRET_KEYS.has(key) || opts.encrypt === true;
    if (isSecret && value === '') return; // no-op: não apaga segredo existente
    const stored = isSecret ? encrypt(value) : value;
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: stored, encrypted: isSecret },
      update: { value: stored, encrypted: isSecret },
    });
    this.invalidate();
  }

  async unset(key: string): Promise<void> {
    await this.prisma.setting.delete({ where: { key } }).catch(() => undefined);
    this.invalidate();
  }

  /** Visão para a UI: valores não-segredos crus; segredos viram `<key>Set: boolean`. */
  async describe(): Promise<Record<string, string | boolean>> {
    const cache = await this.load();
    const out: Record<string, string | boolean> = {};
    for (const [key, row] of cache) {
      if (SECRET_KEYS.has(key) || BULKY_KEYS.has(key)) {
        out[`${key}Set`] = row.value !== '';
      } else {
        out[key] = row.value;
      }
    }
    // segredos sem linha no banco: reporta se há fallback de env
    for (const key of SECRET_KEYS) {
      if (out[`${key}Set`] === undefined) {
        const env = ENV_FALLBACK[key];
        out[`${key}Set`] = !!(env && process.env[env]);
      }
    }
    return out;
  }
}
