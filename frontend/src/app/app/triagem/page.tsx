'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import {
  pauseText,
  useAcceptSuggestion,
  useConversations,
  useDiscardSuggestion,
  useSuggestions,
  usd,
  useWhatsappStatus,
  type ConversationMessage,
} from '@/lib/whatsapp';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const errToast = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
const MAX_CHARS = 300;
const todaySp = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const TYPE_LABEL = { AUDIO: '🎤 áudio', IMAGE: '🖼️ imagem', OTHER: 'outro tipo' } as const;

function MessageRow({ m }: { m: ConversationMessage }) {
  const [open, setOpen] = useState(false);
  const body = m.body ?? '';
  const long = body.length > MAX_CHARS;
  return (
    <li className="flex gap-2 text-sm">
      <span className="w-12 shrink-0 text-xs text-muted-foreground">
        {new Date(m.sentAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
      </span>
      <div className="min-w-0 flex-1">
        <span className="font-medium">{m.senderName || m.senderPhone || 'Desconhecido'}: </span>
        {m.type !== 'TEXT' && !body ? (
          <i className="text-muted-foreground">{TYPE_LABEL[m.type as keyof typeof TYPE_LABEL]}</i>
        ) : (
          <span className="whitespace-pre-wrap break-words">{long && !open ? `${body.slice(0, MAX_CHARS)}…` : body}</span>
        )}
        {long && (
          <button className="ml-1 text-xs text-primary underline" onClick={() => setOpen(!open)}>
            {open ? 'ver menos' : 'ver mais'}
          </button>
        )}
        <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
          {m.ticket && (
            <Link href={`/app/chamados/${m.ticket.id}`}>
              <Badge tone="blue">Chamado {m.ticket.number}</Badge>
            </Link>
          )}
          {m.suggestion === 'OPEN' && <Badge tone="amber">Sugestão da IA</Badge>}
          {m.suggestion === 'ACCEPTED' && <Badge tone="blue">Sugestão aceita</Badge>}
          {m.suggestion === 'DISCARDED' && <Badge tone="neutral">Sugestão descartada</Badge>}
          {!m.ticket && !m.suggestion && m.aiStatus === 'SKIPPED' && <Badge tone="neutral">Ignorada</Badge>}
          {!m.ticket && !m.suggestion && m.aiStatus === 'PENDING' && <Badge tone="neutral">Aguardando IA</Badge>}
        </span>
      </div>
    </li>
  );
}

function ConversationsSection() {
  const [date, setDate] = useState(todaySp);
  const { data, isLoading } = useConversations(date);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[14px] font-semibold">Conversas do dia</h2>
        <input
          type="date"
          aria-label="Data das conversas"
          className="rounded-md border bg-background px-2 py-1 text-sm"
          value={date}
          max={todaySp()}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {data?.clients.length === 0 && (
        <p className="py-4 text-sm text-muted-foreground">Nenhuma mensagem nos grupos neste dia.</p>
      )}
      {data?.clients.map((c) => (
        <details key={c.client.id} open className="rounded-xl bg-card p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-medium">
            {c.client.name} <span className="text-xs text-muted-foreground">({c.total} mensagens)</span>
          </summary>
          {c.groups.map((g) => (
            <div key={g.id} className="mt-3">
              <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{g.name}</p>
              <ul className="flex flex-col gap-1.5">
                {g.messages.map((m) => (
                  <MessageRow key={m.id} m={m} />
                ))}
              </ul>
            </div>
          ))}
        </details>
      ))}
    </section>
  );
}

const URGENCY_TONE = ['neutral', 'neutral', 'blue', 'amber', 'red', 'red'] as const;

export default function TriagemPage() {
  const router = useRouter();
  const { data: suggestions } = useSuggestions();
  const { data: status } = useWhatsappStatus();
  const accept = useAcceptSuggestion();
  const discard = useDiscardSuggestion();

  const conn = status?.connection;
  const disconnected = conn?.configured && conn.state !== 'open';

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Triagem do WhatsApp</h1>

      {disconnected && (
        <p className="rounded-md border border-warning bg-warning px-3 py-2 text-sm text-warning-foreground">
          WhatsApp desconectado
          {conn?.disconnectedSince && ` desde ${new Date(conn.disconnectedSince).toLocaleString('pt-BR')}`}. Mensagens
          deste período podem não ter chegado. Reconecte em Configurações &gt; WhatsApp.
        </p>
      )}
      {status?.ai.lastError && (
        <p className="rounded-md border border-warning bg-warning px-3 py-2 text-sm text-warning-foreground">
          A IA está com problema: {status.ai.lastError.message} (desde{' '}
          {new Date(status.ai.lastError.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}). As
          mensagens continuam na fila e serão analisadas quando voltar.
        </p>
      )}
      {status?.ai.paused && (
        <p className="rounded-md border border-warning bg-warning px-3 py-2 text-sm text-warning-foreground">
          Teto de gasto da IA atingido — novas sugestões voltam {pauseText(status.ai.reason)} (as frases de gatilho
          continuam).
        </p>
      )}
      {status?.ai.warn && (
        <p className="rounded-md border border-warning bg-warning px-3 py-2 text-sm text-warning-foreground">
          O gasto da IA passou de 80% de um dos tetos. Ajuste em Configurações &gt; WhatsApp se precisar.
        </p>
      )}

      {status?.ai && (
        <p className="text-sm text-muted-foreground">
          IA hoje: {usd(status.ai.day.costUsd)} / {usd(status.ai.limits.dailyCostUsd)} · no mês:{' '}
          {usd(status.ai.month.costUsd)} / {usd(status.ai.limits.monthlyCostUsd)}
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        Pedidos que a IA encontrou nos grupos e que não casaram com nenhuma frase de gatilho. Confirme para abrir o
        chamado ou descarte.
      </p>

      <ul className="flex flex-col gap-3">
        {suggestions?.map((s) => (
          <li key={s.id} className="rounded-xl bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={URGENCY_TONE[s.urgency] ?? 'neutral'}>Urgência {s.urgency}</Badge>
              <span className="text-sm font-medium">{s.client.name}</span>
              <span className="text-xs text-muted-foreground">
                {s.group.name ?? s.group.externalId} · {new Date(s.createdAt).toLocaleString('pt-BR')}
              </span>
            </div>
            <p className="mt-2 text-[15px] font-medium">{s.summary}</p>
            <pre className="mt-2 whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs text-muted-foreground">{s.excerpt}</pre>
            <div className="mt-3 flex gap-2">
              <Button
                disabled={accept.isPending}
                onClick={() =>
                  accept.mutate(
                    { id: s.id },
                    {
                      onSuccess: (t) => {
                        toast.success(`Chamado ${t.number} criado.`);
                        router.push(`/app/chamados/${t.id}`);
                      },
                      onError: errToast,
                    },
                  )
                }
              >
                Criar chamado
              </Button>
              <Button
                variant="outline"
                disabled={discard.isPending}
                onClick={() => discard.mutate(s.id, { onSuccess: () => toast.success('Descartada.'), onError: errToast })}
              >
                Descartar
              </Button>
            </div>
          </li>
        ))}
        {suggestions && suggestions.length === 0 && (
          <li className="py-8 text-center text-sm text-muted-foreground">Nenhuma sugestão pendente.</li>
        )}
      </ul>

      <ConversationsSection />
    </div>
  );
}
