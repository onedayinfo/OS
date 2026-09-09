import type { Readable } from 'node:stream';

export interface StoredObject {
  stream: Readable;
  mime?: string;
  size?: number;
}

export interface StorageDriver {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  readable(key: string): Promise<StoredObject>;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
}
