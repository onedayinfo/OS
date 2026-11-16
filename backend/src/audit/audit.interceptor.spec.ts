import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Observable } from 'rxjs';
import { firstValueFrom, lastValueFrom, of, throwError } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor.js';

function montar(req: Record<string, unknown>, statusCode = 200) {
  const record = vi.fn();
  const interceptor = new AuditInterceptor({ record } as never);
  const ctx = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ statusCode }) }),
  } as never;
  return { record, run: (h: Observable<unknown>) => interceptor.intercept(ctx, { handle: () => h }) };
}

describe('AuditInterceptor', () => {
  it('ignora GET', async () => {
    const { record, run } = montar({ method: 'GET', originalUrl: '/api/clients' });
    await lastValueFrom(run(of(1)));
    expect(record).not.toHaveBeenCalled();
  });

  it('registra PUT com módulo, path sem query e ator', async () => {
    const { record, run } = montar({ method: 'PUT', originalUrl: '/api/clients/abc?x=1', user: { id: 'u1' }, body: { a: 1 } });
    await lastValueFrom(run(of('ok')));
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ACTION', level: 'info', module: 'clients', path: '/api/clients/abc', status: 200, actorId: 'u1' }),
    );
  });

  it('login com erro 401: relança e registra warn com e-mail', async () => {
    const { record, run } = montar({ method: 'POST', originalUrl: '/api/auth/login', body: { email: 'a@b', password: 'x' } });
    await expect(lastValueFrom(run(throwError(() => new UnauthorizedException())))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ status: 401, level: 'warn', actorLabel: 'a@b', actorId: null }),
    );
  });

  it('não registra prefixo excluído', async () => {
    const { record, run } = montar({ method: 'POST', originalUrl: '/api/agent/checkin' });
    await lastValueFrom(run(of(1)));
    expect(record).not.toHaveBeenCalled();
  });

  it('upload: só name/size/mime, sem buffer', async () => {
    const { record, run } = montar({
      method: 'POST',
      originalUrl: '/api/files',
      file: { originalname: 'a.pdf', size: 10, mimetype: 'application/pdf', buffer: Buffer.from('x') },
    });
    await lastValueFrom(run(of(1)));
    expect(record.mock.calls[0][0].data.files).toEqual([{ name: 'a.pdf', size: 10, mime: 'application/pdf' }]);
  });

  it('record lançando não impede a resposta', async () => {
    const { record, run } = montar({ method: 'POST', originalUrl: '/api/x' });
    record.mockImplementation(() => { throw new Error('boom'); });
    await expect(firstValueFrom(run(of('resp')))).resolves.toBe('resp');
  });
});
