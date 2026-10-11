import { BadGatewayException } from '@nestjs/common';
import { EvolutionGroupsService } from './evolution-groups.service.js';

function make(resp: any, linked: any[] = [], config: any = { url: 'u', apiKey: 'k', instance: 'os' }) {
  const evo = { config: vi.fn().mockResolvedValue(config), request: vi.fn().mockResolvedValue(resp) };
  const prisma = { whatsappGroup: { findMany: vi.fn().mockResolvedValue(linked) } };
  return { svc: new EvolutionGroupsService(evo as any, prisma as any), evo, prisma };
}

describe('EvolutionGroupsService.list', () => {
  it('normaliza nome/tamanho, ordena por nome e marca os já vinculados', async () => {
    const { svc, evo, prisma } = make(
      { ok: true, status: 200, body: [
        { id: '120363000000000002@g.us', subject: 'Zeta Suporte', size: 7 },
        { id: '120363000000000001@g.us', subject: 'Acme TI', participants: [{}, {}, {}] },
      ] },
      [{ externalId: '120363000000000001@g.us', client: { id: 'c1', name: 'Acme' } }],
    );
    const out = await svc.list();
    expect(evo.request.mock.calls[0][1]).toBe('/group/fetchAllGroups/os?getParticipants=false');
    expect(out).toEqual([
      { id: '120363000000000001@g.us', name: 'Acme TI', size: 3, linkedClientId: 'c1', linkedClientName: 'Acme' },
      { id: '120363000000000002@g.us', name: 'Zeta Suporte', size: 7, linkedClientId: null, linkedClientName: null },
    ]);
    expect(prisma.whatsappGroup.findMany.mock.calls[0][0].where).toEqual({
      externalId: { in: ['120363000000000002@g.us', '120363000000000001@g.us'] },
    });
  });

  it('ignora o que não é grupo e formatos estranhos; corpo vazio → lista vazia', async () => {
    const { svc } = make({ ok: true, status: 200, body: [
      { id: '5519999991234@s.whatsapp.net', subject: 'contato' },
      { subject: 'sem id' },
      null,
      { remoteJid: '120363000000000009@g.us', name: 'Outro formato' },
    ] });
    expect(await svc.list()).toEqual([
      { id: '120363000000000009@g.us', name: 'Outro formato', size: null, linkedClientId: null, linkedClientName: null },
    ]);
    expect(await make({ ok: true, status: 200, body: null }).svc.list()).toEqual([]);
  });

  it('Evolution fora do ar → 502; não configurada → 502; HTTP de erro → 502 com o status', async () => {
    await expect(make({ ok: false, status: 0, body: null }).svc.list()).rejects.toBeInstanceOf(BadGatewayException);
    await expect(make({}, [], null).svc.list()).rejects.toThrow(/não configurada/i);
    await expect(make({ ok: false, status: 500, body: null }).svc.list()).rejects.toThrow(/500/);
  });
});
