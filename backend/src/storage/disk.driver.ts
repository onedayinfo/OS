import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { StorageDriver, StoredObject } from './storage.types.js';

/** Driver de disco. `key` relativa fica sob `STORAGE_PATH`; caminho absoluto é usado como está. */
export class DiskStorageDriver implements StorageDriver {
  private base(): string {
    return resolve(process.env.STORAGE_PATH ?? './uploads');
  }

  private full(key: string): string {
    return isAbsolute(key) ? key : join(this.base(), key);
  }

  async put(key: string, body: Buffer, _mime: string): Promise<void> {
    const path = this.full(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async readable(key: string): Promise<StoredObject> {
    const path = this.full(key);
    const s = await stat(path);
    return { stream: createReadStream(path), size: s.size };
  }

  async remove(key: string): Promise<void> {
    await rm(this.full(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    return stat(this.full(key)).then(
      () => true,
      () => false,
    );
  }

  async list(prefix: string): Promise<string[]> {
    const root = join(this.base(), prefix);
    const dir = await readdir(root, { withFileTypes: true }).catch(() => []);
    return dir.filter((d) => d.isFile()).map((d) => `${prefix}${d.name}`.split(sep).join('/'));
  }
}
