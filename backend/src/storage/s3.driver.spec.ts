import { beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn();
vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    send = send;
  }
  class PutObjectCommand {
    constructor(public input: any) {}
  }
  class GetObjectCommand {
    constructor(public input: any) {}
  }
  class DeleteObjectCommand {
    constructor(public input: any) {}
  }
  class ListObjectsV2Command {
    constructor(public input: any) {}
  }
  class HeadObjectCommand {
    constructor(public input: any) {}
  }
  return {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
    HeadObjectCommand,
  };
});

import { S3StorageDriver } from './s3.driver.js';

function settings(map: Record<string, string>) {
  return { get: vi.fn(async (k: string) => map[k]) };
}
const base = {
  'storage.s3.region': 'auto',
  'storage.s3.bucket': 'meu-bucket',
  'storage.s3.accessKeyId': 'AK',
  'storage.s3.secretAccessKey': 'SK',
  'storage.s3.prefix': 'os/',
};

describe('S3StorageDriver', () => {
  beforeEach(() => send.mockReset());

  it('fromSettings sem bucket lança', async () => {
    await expect(S3StorageDriver.fromSettings(settings({}) as any)).rejects.toThrow();
  });

  it('put manda PutObjectCommand com Key prefixada', async () => {
    send.mockResolvedValue({});
    const d = await S3StorageDriver.fromSettings(settings(base) as any);
    await d.put('attachments/x.png', Buffer.from('x'), 'image/png');
    const cmd = send.mock.calls[0][0];
    expect(cmd.input.Bucket).toBe('meu-bucket');
    expect(cmd.input.Key).toBe('os/attachments/x.png');
    expect(cmd.input.ContentType).toBe('image/png');
  });

  it('list devolve keys sem o prefixo', async () => {
    send.mockResolvedValue({
      Contents: [{ Key: 'os/backups/1.json' }, { Key: 'os/backups/2.json' }],
    });
    const d = await S3StorageDriver.fromSettings(settings(base) as any);
    expect(await d.list('backups/')).toEqual(['backups/1.json', 'backups/2.json']);
  });
});
