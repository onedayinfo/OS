'use client';

import Link from 'next/link';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { useClientAgent, useRegenerateAgentCode } from '@/lib/agent';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const errToast = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');

export function ClientAgentTab({ clientId }: { clientId: string }) {
  const { data, isLoading } = useClientAgent(clientId);
  const regen = useRegenerateAgentCode(clientId);

  if (isLoading || !data) return <p className="pt-4 text-sm text-muted-foreground">Carregando…</p>;

  const generate = (confirmFirst: boolean) => {
    if (
      confirmFirst &&
      !confirm('Gerar novo código? Instalações novas com o código antigo deixam de funcionar; PCs já instalados continuam.')
    )
      return;
    regen.mutate(undefined, { onSuccess: () => toast.success('Código gerado.'), onError: errToast });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.code ?? '');
      toast.success('Código copiado.');
    } catch {
      toast.error('Não foi possível copiar; selecione o código e copie manualmente.');
    }
  };

  const counters = [
    ['Vinculados', data.counts.linked],
    ['Aguardando cadastro', data.counts.pending],
    ['Ignorados', data.counts.ignored],
    ['Sem contato +30 dias', data.counts.stale],
  ] as const;

  return (
    <div className="flex flex-col gap-6 pt-4">
      {!data.contractValid && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Cliente sem contrato ativo — os PCs deste cliente não conseguem se conectar.
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {counters.map(([label, n]) => (
          <div key={label} className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="text-2xl font-semibold">{n}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </section>

      <section className="flex max-w-xl flex-col gap-2">
        <h2 className="text-[14px] font-semibold">Código de instalação</h2>
        {data.code ? (
          <>
            <Label htmlFor="agent-code">Código</Label>
            <div className="flex gap-2">
              <Input id="agent-code" readOnly value={data.code} className="font-mono" />
              <Button type="button" variant="outline" onClick={copy}>
                Copiar
              </Button>
              <Button type="button" variant="outline" disabled={regen.isPending} onClick={() => generate(true)}>
                Gerar novo código
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Nenhum código gerado ainda</span>
            <Button type="button" disabled={regen.isPending} onClick={() => generate(false)}>
              Gerar código
            </Button>
          </div>
        )}
      </section>

      <Link
        href={`/app/ativos/fila?clientId=${clientId}`}
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Ver fila de cadastro
      </Link>
    </div>
  );
}
