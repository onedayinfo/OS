import { describe, expect, it, vi } from 'vitest';
import { ROLES_KEY } from '../common/roles.decorator.js';
import { AuditController } from './audit.controller.js';

describe('AuditController', () => {
  it('GET /audit repassa a query ao serviço', async () => {
    const resposta = { data: [], total: 0, page: 2, pageSize: 10 };
    const audit = { list: vi.fn().mockResolvedValue(resposta), modules: vi.fn() };
    const c = new AuditController(audit as any);
    const q = { kind: 'ERROR', page: 2, pageSize: 10 } as any;
    expect(await c.list(q)).toEqual(resposta);
    expect(audit.list).toHaveBeenCalledWith(q);
  });

  it('GET /audit/modules devolve a lista do serviço', async () => {
    const audit = { list: vi.fn(), modules: vi.fn().mockResolvedValue(['auth', 'tickets']) };
    const c = new AuditController(audit as any);
    expect(await c.modules()).toEqual(['auth', 'tickets']);
  });

  it('restringe o controller a ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AuditController)).toEqual(['ADMIN']);
  });
});
