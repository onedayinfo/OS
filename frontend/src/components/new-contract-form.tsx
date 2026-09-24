'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { type Paged } from '@/lib/tickets';
import { useCreateContract, type FranchiseUnit } from '@/lib/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

function onErr(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
}

export function NewContractForm({
  defaultClientId,
  onCreated,
  onCancel,
}: {
  defaultClientId?: string;
  onCreated: (contractId: string) => void;
  onCancel: () => void;
}) {
  const create = useCreateContract();
  const lockClient = !!defaultClientId;

  const [clientId, setClientId] = useState(defaultClientId ?? '');
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [monthlyValue, setMonthlyValue] = useState('');
  const [franchiseUnit, setFranchiseUnit] = useState<FranchiseUnit>('VISITS');
  const [franchiseAmount, setFranchiseAmount] = useState('4');

  const { data: clients } = useQuery({
    queryKey: ['clients', 'all'],
    queryFn: () => api<Paged<{ id: string; name: string }>>('/clients?pageSize=100'),
  });

  function submit() {
    if (!clientId || !name.trim() || !startDate || !endDate) {
      toast.error('Preencha cliente, nome e vigência.');
      return;
    }
    create.mutate(
      {
        clientId,
        name: name.trim(),
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        monthlyValue: monthlyValue ? Number(monthlyValue) : undefined,
        franchiseUnit,
        franchiseAmount: Number(franchiseAmount),
      },
      {
        onSuccess: (created) => {
          toast.success('Contrato criado.');
          onCreated(created.id);
        },
        onError: onErr,
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Cliente</Label>
        <Select value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={lockClient}>
          <option value="">Selecione…</option>
          {clients?.data.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Nome</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Contrato Matriz 2026" />
      </div>

      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Início</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Fim</Label>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Valor mensal (R$)</Label>
        <Input type="number" min="0" value={monthlyValue} onChange={(e) => setMonthlyValue(e.target.value)} />
      </div>

      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Franquia — unidade</Label>
          <Select value={franchiseUnit} onChange={(e) => setFranchiseUnit(e.target.value as FranchiseUnit)}>
            <option value="VISITS">Visitas/mês</option>
            <option value="HOURS">Horas/mês</option>
          </Select>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Franquia — quantidade</Label>
          <Input type="number" min="1" value={franchiseAmount} onChange={(e) => setFranchiseAmount(e.target.value)} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Escopo (Locais/Ativos) e SLA por prioridade se editam na ficha, depois de criar.
      </p>

      <div className="flex gap-2">
        <Button disabled={create.isPending} onClick={submit}>
          Criar contrato
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
