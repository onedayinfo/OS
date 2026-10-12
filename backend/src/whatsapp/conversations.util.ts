/** Dia civil de São Paulo (YYYY-MM-DD) de agora. */
export function todaySp(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

/** [início, fim) do dia em São Paulo. ponytail: UTC-3 fixo (sem horário de verão desde 2019). */
export function dayRange(date: string): { gte: Date; lt: Date } {
  const gte = new Date(`${date}T00:00:00-03:00`);
  return { gte, lt: new Date(gte.getTime() + 24 * 60 * 60 * 1000) };
}

export interface ConversationMessage {
  id: string;
  groupId: string;
  sentAt: Date;
  [k: string]: unknown;
}
export interface ConversationGroupInput {
  id: string;
  name: string | null;
  externalId: string;
  client: { id: string; name: string };
}

/** Agrupa mensagens do dia por cliente > grupo; mensagens em ordem de horário. */
export function groupConversations<M extends ConversationMessage>(groups: ConversationGroupInput[], messages: M[]) {
  const byGroup = new Map<string, M[]>();
  for (const m of messages) byGroup.set(m.groupId, [...(byGroup.get(m.groupId) ?? []), m]);
  const clients = new Map<string, { client: { id: string; name: string }; total: number; groups: unknown[] }>();
  for (const g of groups) {
    const msgs = (byGroup.get(g.id) ?? []).sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    if (!msgs.length) continue;
    const c = clients.get(g.client.id) ?? { client: g.client, total: 0, groups: [] };
    c.total += msgs.length;
    c.groups.push({ id: g.id, name: g.name ?? g.externalId, messages: msgs });
    clients.set(g.client.id, c);
  }
  return [...clients.values()].sort((a, b) => a.client.name.localeCompare(b.client.name, 'pt-BR'));
}
