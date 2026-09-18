'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { type Paged } from '@/lib/tickets';
import { type Asset } from '@/lib/assets';
import {
  CONTRACT_STATUS_LABELS,
  FRANCHISE_UNIT_LABELS,
  useCancelContract,
  useContract,
  useUpdateContract,
  type ContractSlaOverride,
} from '@/lib/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function onErr(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
}

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const PRIORITY_LABEL: Record<(typeof PRIORITIES)[number], string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};

export default function ContractDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { data: contract, isLoading } = useContract(id);
  const update = useUpdateContract(id);
  const cancel = useCancelContract(id);

  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [slaHours, setSlaHours] = useState<Record<string, string>>({});

  const { data: locations } = useQuery({
    queryKey: ['locations', contract?.clientId],
    queryFn: () =>
      api<Paged<{ id: string; name: string }>>(`/locations?clientId=${contract!.clientId}&pageSize=100`),
    enabled: !!contract,
  });
  const { data: assets } = useQuery({
    queryKey: ['assets', contract?.clientId],
    queryFn: () => api<Paged<Asset>>(`/assets?clientId=${contract!.clientId}&pageSize=200`),
    enabled: !!contract,
  });

  useEffect(() => {
    if (!contract) return;
    setLocationIds(contract.locations.map((l) => l.id));
    setAssetIds(contract.assets.map((a) => a.id));
    const overrides: Record<string, string> = {};
    for (const o of contract.slaOverrides) overrides[o.priority] = String(o.hours);
    setSlaHours(overrides);
  }, [contract]);

  if (isLoading || !contract) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  function saveScope() {
    update.mutate(
      { locationIds, assetIds },
      { onSuccess: () => toast.success('Escopo atualizado.'), onError: onErr },
    );
  }

  function saveSla() {
    const overrides: ContractSlaOverride[] = PRIORITIES.filter((p) => slaHours[p]?.trim()).map((p) => ({
      priority: p,
      hours: Number(slaHours[p]),
    }));
    update.mutate(
      { slaOverrides: overrides },
      { onSuccess: () => toast.success('SLA do contrato atualizado.'), onError: onErr },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{contract.client?.name}</p>
          <h1 className="text-lg font-semibold">{contract.name}</h1>
        </div>
        <Badge tone={contract.status === 'ACTIVE' ? 'green' : contract.status === 'EXPIRED' ? 'amber' : 'neutral'}>
          {CONTRACT_STATUS_LABELS[contract.status]}
        </Badge>
      </div>

      <section className="grid max-w-xl grid-cols-2 gap-3 rounded-lg border border-border p-3 text-sm">
        <div>
          <span className="text-xs uppercase text-muted-foreground">Vigência</span>
          <p>
            {new Date(contract.startDate).toLocaleDateString('pt-BR')} –{' '}
            {new Date(contract.endDate).toLocaleDateString('pt-BR')}
          </p>
        </div>
        <div>
          <span className="text-xs uppercase text-muted-foreground">Valor mensal</span>
          <p>{contract.monthlyValue != null ? `R$ ${contract.monthlyValue.toFixed(2)}` : '—'}</p>
        </div>
        <div>
          <span className="text-xs uppercase text-muted-foreground">Consumo do mês</span>
          <p>
            {contract.consumption.used}/{contract.consumption.franchiseAmount}{' '}
            {FRANCHISE_UNIT_LABELS[contract.consumption.unit]}
            {contract.consumption.exceeded && (
              <Badge tone="amber" className="ml-2">
                Excedente
              </Badge>
            )}
          </p>
        </div>
      </section>

      <section className="flex max-w-xl flex-col gap-2">
        <h2 className="text-sm font-semibold">Escopo — Locais</h2>
        <div className="flex flex-col gap-1 rounded-md border border-input p-2">
          {locations?.data.map((l) => (
            <label key={l.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={locationIds.includes(l.id)}
                onChange={(e) =>
                  setLocationIds((prev) =>
                    e.target.checked ? [...prev, l.id] : prev.filter((x) => x !== l.id),
                  )
                }
              />
              {l.name}
            </label>
          ))}
        </div>
        <h2 className="text-sm font-semibold">Escopo — Ativos</h2>
        <div className="flex flex-col gap-1 rounded-md border border-input p-2">
          {assets?.data.map((a) => (
            <label key={a.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={assetIds.includes(a.id)}
                onChange={(e) =>
                  setAssetIds((prev) =>
                    e.target.checked ? [...prev, a.id] : prev.filter((x) => x !== a.id),
                  )
                }
              />
              {a.label}
            </label>
          ))}
        </div>
        <Button variant="outline" className="h-9 self-start" disabled={update.isPending} onClick={saveScope}>
          Salvar escopo
        </Button>
      </section>

      <section className="flex max-w-xl flex-col gap-2">
        <h2 className="text-sm font-semibold">SLA do contrato (opcional)</h2>
        {PRIORITIES.map((p) => (
          <div key={p} className="flex items-center gap-3">
            <Label className="w-24">{PRIORITY_LABEL[p]}</Label>
            <Input
              type="number"
              min="1"
              placeholder="usa o global"
              className="w-32"
              value={slaHours[p] ?? ''}
              onChange={(e) => setSlaHours((prev) => ({ ...prev, [p]: e.target.value }))}
            />
            <span className="text-sm text-muted-foreground">horas</span>
          </div>
        ))}
        <Button variant="outline" className="h-9 self-start" disabled={update.isPending} onClick={saveSla}>
          Salvar SLA
        </Button>
      </section>

      {contract.status === 'ACTIVE' && (
        <Button
          variant="outline"
          className="h-9 w-fit text-red-600"
          disabled={cancel.isPending}
          onClick={() => {
            if (confirm('Cancelar este contrato?')) {
              cancel.mutate(undefined, { onSuccess: () => toast.success('Contrato cancelado.'), onError: onErr });
            }
          }}
        >
          Cancelar contrato
        </Button>
      )}
    </div>
  );
}
