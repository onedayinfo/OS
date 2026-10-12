import { dayRange, groupConversations } from './conversations.util.js';

describe('conversations.util', () => {
  it('dia de São Paulo = 03:00Z até 03:00Z do dia seguinte', () => {
    const r = dayRange('2026-10-12');
    expect(r.gte.toISOString()).toBe('2026-10-12T03:00:00.000Z');
    expect(r.lt.toISOString()).toBe('2026-10-13T03:00:00.000Z');
    expect(Number.isNaN(dayRange('2026-13-45').gte.getTime())).toBe(true);
  });

  it('agrupa por cliente > grupo, ordena por horário e ignora grupo sem mensagem', () => {
    const A = { id: 'g1', name: null, externalId: 'x@g.us', client: { id: 'c1', name: 'Zeta' } };
    const B = { id: 'g2', name: 'Fin', externalId: 'y@g.us', client: { id: 'c2', name: 'Alfa' } };
    const C = { id: 'g3', name: 'Vazio', externalId: 'z@g.us', client: { id: 'c2', name: 'Alfa' } };
    const m = (id: string, groupId: string, h: number) => ({ id, groupId, sentAt: new Date(Date.UTC(2026, 9, 12, h)) });
    const out = groupConversations([A, B, C], [m('2', 'g1', 12), m('1', 'g1', 10), m('3', 'g2', 11)]);
    expect(out.map((c) => c.client.name)).toEqual(['Alfa', 'Zeta']);
    expect(out[0].total).toBe(1);
    expect(out[0].groups).toHaveLength(1);
    const g = out[1].groups[0] as { name: string; messages: { id: string }[] };
    expect(g.name).toBe('x@g.us');
    expect(g.messages.map((x) => x.id)).toEqual(['1', '2']);
  });
});
