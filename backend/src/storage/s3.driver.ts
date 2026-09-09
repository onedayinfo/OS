import type { Readable } from 'node:stream';
import { BadRequestException } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { SettingsService } from '../settings/settings.service.js';
import type { StorageDriver, StoredObject } from './storage.types.js';

/** Driver S3 (compatível com AWS S3, Cloudflare R2 e MinIO). */
export class S3StorageDriver implements StorageDriver {
  private constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly prefix: string,
  ) {}

  static async fromSettings(settings: SettingsService): Promise<S3StorageDriver> {
    const [endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle, prefix] =
      await Promise.all([
        settings.get('storage.s3.endpoint'),
        settings.get('storage.s3.region'),
        settings.get('storage.s3.bucket'),
        settings.get('storage.s3.accessKeyId'),
        settings.get('storage.s3.secretAccessKey'),
        settings.get('storage.s3.forcePathStyle'),
        settings.get('storage.s3.prefix'),
      ]);
    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new BadRequestException('Configure bucket, access key e secret key do S3.');
    }
    const client = new S3Client({
      region: region || 'us-east-1',
      endpoint: endpoint || undefined,
      forcePathStyle: forcePathStyle === 'true',
      credentials: { accessKeyId, secretAccessKey },
    });
    return new S3StorageDriver(client, bucket, prefix ?? '');
  }

  private k(key: string): string {
    return `${this.prefix}${key}`;
  }

  async put(key: string, body: Buffer, mime: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.k(key),
        Body: body,
        ContentType: mime,
      }),
    );
  }

  async readable(key: string): Promise<StoredObject> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.k(key) }),
    );
    return {
      stream: res.Body as Readable,
      mime: res.ContentType,
      size: res.ContentLength,
    };
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.k(key) }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.k(key) }));
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const res = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: this.k(prefix) }),
    );
    return (res.Contents ?? [])
      .map((o) => o.Key ?? '')
      .filter(Boolean)
      .map((k) => k.slice(this.prefix.length));
  }
}
