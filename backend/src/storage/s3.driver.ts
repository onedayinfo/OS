// Stub — implementação real na Task 5 (feat: driver S3 com @aws-sdk/client-s3).
import type { SettingsService } from '../settings/settings.service.js';
import type { StorageDriver, StoredObject } from './storage.types.js';

export class S3StorageDriver implements StorageDriver {
  static async fromSettings(_s: SettingsService): Promise<S3StorageDriver> {
    throw new Error('Driver S3 ainda não configurado.');
  }
  put(): Promise<void> {
    throw new Error('não implementado');
  }
  readable(): Promise<StoredObject> {
    throw new Error('não implementado');
  }
  remove(): Promise<void> {
    throw new Error('não implementado');
  }
  exists(): Promise<boolean> {
    throw new Error('não implementado');
  }
  list(): Promise<string[]> {
    throw new Error('não implementado');
  }
}
