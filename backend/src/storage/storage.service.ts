import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service.js';
import { DiskStorageDriver } from './disk.driver.js';
import { S3StorageDriver } from './s3.driver.js';
import type { StorageDriver, StoredObject } from './storage.types.js';

/** `true` para caminhos absolutos POSIX/UNC/Windows (linhas antigas de Attachment). */
export function isLegacyDiskPath(key: string): boolean {
  return key.startsWith('/') || key.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(key);
}

@Injectable()
export class StorageService {
  private readonly disk = new DiskStorageDriver();

  constructor(private readonly settings: SettingsService) {}

  async activeDriver(): Promise<'disk' | 's3'> {
    return (await this.settings.get('storage.driver')) === 's3' ? 's3' : 'disk';
  }

  private async driver(): Promise<StorageDriver> {
    if ((await this.activeDriver()) === 's3') {
      return await S3StorageDriver.fromSettings(this.settings);
    }
    return this.disk;
  }

  put(key: string, body: Buffer, mime: string): Promise<void> {
    return this.driver().then((d) => d.put(key, body, mime));
  }

  async readable(key: string): Promise<StoredObject> {
    // Dual-read: caminho absoluto legado, ou objeto que ainda mora no disco.
    if (isLegacyDiskPath(key) || (await this.disk.exists(key))) {
      return this.disk.readable(key);
    }
    return (await this.driver()).readable(key);
  }

  remove(key: string): Promise<void> {
    return this.driver().then((d) => d.remove(key));
  }

  exists(key: string): Promise<boolean> {
    return this.driver().then((d) => d.exists(key));
  }

  list(prefix: string): Promise<string[]> {
    return this.driver().then((d) => d.list(prefix));
  }

  /** Sonda de escrita/leitura/remoção — usado pelo "Testar conexão" da UI. */
  async testConnection(): Promise<void> {
    const key = `__probe/${randomUUID()}`;
    const d = await this.driver();
    await d.put(key, Buffer.from('probe'), 'text/plain');
    await d.remove(key);
  }
}
