'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { useAcceptSuggestion, useDiscardSuggestion, useSuggestions, useWhatsappStatus } from '@/lib/whatsapp';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const errToast = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
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
      {status?.ai.paused && (
        <p className="rounded-md border border-warning bg-warning px-3 py-2 text-sm text-warning-foreground">
          Teto diário de tokens da IA atingido — novas sugestões voltam amanhã (as frases de gatilho continuam).
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
    </div>
  );
}
