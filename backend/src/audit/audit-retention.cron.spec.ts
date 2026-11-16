import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { AuditRetentionCron } from './audit-retention.cron.js';

async function rodar(setting: string | null) {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  const audit = { purgeOlderThan: vi.fn().mockResolvedValue(2) };
  const settings = { get: vi.fn().mockResolvedValue(setting) };
  await new AuditRetentionCron(audit as never, settings as never).run();
  expect(settings.get).toHaveBeenCalledWith('audit.retentionDays');
  return audit.purgeOlderThan;
}

describe('AuditRetentionCron', () => {
  it('padrão 90 quando null', async () => expect(await rodar(null)).toHaveBeenCalledWith(90));
  it('usa o valor configurado', async () => expect(await rodar('30')).toHaveBeenCalledWith(30));
  it('inválido cai em 90', async () => expect(await rodar('abc')).toHaveBeenCalledWith(90));
  it('zero ou negativo cai em 90', async () => {
    expect(await rodar('0')).toHaveBeenCalledWith(90);
    expect(await rodar('-5')).toHaveBeenCalledWith(90);
  });
});
