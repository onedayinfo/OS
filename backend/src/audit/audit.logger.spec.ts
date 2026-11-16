import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditLogger } from './audit.logger.js';

function setup() {
  const audit = { record: vi.fn() };
  const logger = new AuditLogger(audit as never);
  // silencia a saída real do ConsoleLogger
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  return { audit, logger };
}

afterEach(() => vi.restoreAllMocks());

describe('AuditLogger', () => {
  it('warn com contexto grava ERROR/warn', () => {
    const { audit, logger } = setup();
    logger.warn('falhou s3', 'SettingsController');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ERROR', level: 'warn', module: 'SettingsController', message: 'falhou s3' }),
    );
  });

  it('error com Error: message legível, stack em data, módulo app', () => {
    const { audit, logger } = setup();
    logger.error(new Error('boom'));
    const e = audit.record.mock.calls[0][0];
    expect(e.message).toBe('boom');
    expect(e.module).toBe('app');
    expect(e.data.stack).toContain('boom');
  });

  it('error(msg, stack, contexto)', () => {
    const { audit, logger } = setup();
    logger.error('x', 'stack\nlinha', 'TicketsService');
    const e = audit.record.mock.calls[0][0];
    expect(e.module).toBe('TicketsService');
    expect(e.data.stack).toBe('stack\nlinha');
  });

  it('error(msg, stack) sem contexto: stack não vira módulo', () => {
    const { audit, logger } = setup();
    logger.error('x', 'stack\nlinha');
    const e = audit.record.mock.calls[0][0];
    expect(e.module).toBe('app');
    expect(e.data.stack).toBe('stack\nlinha');
  });

  it('log não grava', () => {
    const { audit, logger } = setup();
    logger.log('ok');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('ignora contexto AuditService (anti-recursão)', () => {
    const { audit, logger } = setup();
    logger.error('x', 'AuditService');
    expect(audit.record).not.toHaveBeenCalled();
  });
});
