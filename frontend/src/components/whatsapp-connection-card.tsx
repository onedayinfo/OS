'use client';

import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { useConnect, useSetup, type SetupStep } from '@/lib/whatsapp';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const MARK: Record<SetupStep['status'], string> = { ok: '✓', error: '✗', pending: '•' };
const SR: Record<SetupStep['status'], string> = { ok: 'ok', error: 'erro', pending: 'pendente' };
const TONE: Record<SetupStep['status'], 'green' | 'red' | 'neutral'> = { ok: 'green', error: 'red', pending: 'neutral' };

export function WhatsappConnectionCard() {
  const { data: report, isLoading, isError } = useSetup();
  const connect = useConnect();

  return (
    <section className="flex max-w-lg flex-col gap-3 rounded-xl bg-card p-5 shadow-sm">
      <h2 className="text-[14px] font-semibold">Conexão com o WhatsApp</h2>

      {isLoading && <p className="text-sm text-muted-foreground">Verificando…</p>}
      {isError && <p className="text-sm text-destructive">Não foi possível consultar a conexão agora.</p>}

      {report && (
        <ul className="flex flex-col gap-2" aria-label="Etapas da conexão">
          {report.steps.map((s) => (
            <li key={s.id} className="flex items-start gap-2 text-sm">
              <Badge tone={TONE[s.status]}>{MARK[s.status]}<span className="sr-only">{SR[s.status]}</span></Badge>
              <div>
                <div className="font-medium">{s.label}</div>
                {s.detail && <div className="text-xs text-muted-foreground">{s.detail}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Button
        className="self-start"
        disabled={connect.isPending}
        onClick={() =>
          connect.mutate(undefined, {
            onSuccess: (r) => {
              const falhou = r.steps.find((s) => s.status === 'error');
              if (falhou) toast.error(falhou.detail ?? 'Falha ao conectar.');
              else if (r.state === 'open') toast.success('WhatsApp conectado.');
              else if (r.qr?.base64 || r.qr?.pairingCode) toast.success('Configuração concluída. Escaneie o QR code.');
              else toast('Configuração concluída, mas o WhatsApp ainda não está pareado.');
            },
            onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao conectar.'),
          })
        }
      >
        {connect.isPending ? 'Conectando…' : 'Conectar / Reparar'}
      </Button>

      {report?.qr?.base64?.startsWith('data:image/') && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={report.qr.base64} alt="QR code do WhatsApp" className="h-56 w-56 rounded border border-border bg-white p-2" />
      )}
      {report?.qr?.pairingCode && (
        <p className="text-sm">
          Código de pareamento: <b>{report.qr.pairingCode}</b>
        </p>
      )}
      {report && report.state !== 'open' && report.state !== 'not_configured' && (
        <p className="text-xs text-muted-foreground">
          No celular dedicado: WhatsApp &gt; Aparelhos conectados &gt; Conectar um aparelho. O estado atualiza sozinho.
        </p>
      )}
    </section>
  );
}
