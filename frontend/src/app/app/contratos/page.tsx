'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { type Paged } from '@/lib/tickets';
import {
  CONTRACT_STATUS_LABELS,
  FRANCHISE_UNIT_LABELS,
  useContracts,
  type Contract,
  type ContractStatus,
} from '@/lib/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

function statusTone(s: ContractStatus) {
  return s === 'ACTIVE' ? 'green' : s === 'EXPIRED' ? 'amber' : 'neutral';
}

export default function ContractsPage() {
  const [clientId, setClientId] = useState('');
  const [status, setStatus] = useState<ContractStatus | ''>('');
  const { data: contracts, isLoading } = useContracts({
    clientId: clientId || undefined,
    status: status || undefined,
  });
  const { data: clients } = useQuery({
    queryKey: ['clients', 'all'],
    queryFn: () => api<Paged<{ id: string; name: string }>>('/clients?pageSize=100'),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Contratos</h1>
        <Link href="/app/contratos/novo">
          <Button className="h-9">Novo contrato</Button>
        </Link>
      </div>

      <div className="flex gap-2">
        <Select className="h-9 w-56" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">Todos os clientes</option>
          {clients?.data.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select className="h-9 w-40" value={status} onChange={(e) => setStatus(e.target.value as ContractStatus | '')}>
          <option value="">Todos os status</option>
          {Object.entries(CONTRACT_STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {!isLoading && (contracts?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum contrato encontrado.</p>
      )}

      <ul className="flex flex-col gap-1">
        {contracts?.map((c) => (
          <ContractRow key={c.id} contract={c} />
        ))}
      </ul>
    </div>
  );
}

function ContractRow({ contract }: { contract: Contract }) {
  return (
    <li>
      <Link
        href={`/app/contratos/${contract.id}`}
        className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
      >
        <span className="font-medium">{contract.name}</span>
        <span className="text-muted-foreground">{contract.client?.name}</span>
        <span className="text-xs text-muted-foreground">
          {new Date(contract.startDate).toLocaleDateString('pt-BR')}–
          {new Date(contract.endDate).toLocaleDateString('pt-BR')}
        </span>
        <Badge tone={statusTone(contract.status)}>{CONTRACT_STATUS_LABELS[contract.status]}</Badge>
        <span className="ml-auto flex items-center gap-2 text-xs">
          {contract.consumption.used}/{contract.consumption.franchiseAmount}{' '}
          {FRANCHISE_UNIT_LABELS[contract.consumption.unit]}
          {contract.consumption.exceeded && <Badge tone="amber">Excedente</Badge>}
        </span>
      </Link>
    </li>
  );
}
