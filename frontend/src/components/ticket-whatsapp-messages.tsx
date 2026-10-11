'use client';

import { useTicketMessages } from '@/lib/whatsapp';

export function TicketWhatsappMessages({ ticketId, origin }: { ticketId: string; origin: string }) {
  const { data } = useTicketMessages(ticketId, origin === 'WHATSAPP');
  if (!data || data.length === 0) return null;

  return (
    <section className="rounded-xl bg-card p-5 shadow-sm">
      <h2 className="mb-3 text-[14px] font-semibold">Mensagens do WhatsApp</h2>
      <ul className="flex flex-col gap-2">
        {data.map((m) => (
          <li key={m.id} className="text-[13px]">
            <span className="font-medium">{m.senderName ?? (m.senderPhone || 'alguém')}</span>
            <span className="text-muted-foreground">
              {' '}
              · {m.group.name ?? 'grupo'} · {new Date(m.sentAt).toLocaleString('pt-BR')}
            </span>
            <div>{m.body}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
