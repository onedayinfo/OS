'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { type Paged } from '@/lib/tickets';
import { useCreateOpportunity } from '@/lib/crm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

function onErr(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
}

export function NewOpportunityForm({
  currentUserId,
  onCreated,
}: {
  currentUserId: string;
  onCreated: (id: string) => void;
}) {
  const create = useCreateOpportunity();
  const [isLead, setIsLead] = useState(true);
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [ownerId, setOwnerId] = useState(currentUserId);
  const [clientId, setClientId] = useState('');
  const [leadName, setLeadName] = useState('');
  const [leadCompany, setLeadCompany] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadEmail, setLeadEmail] = useState('');

  const { data: clients } = useQuery({
    queryKey: ['clients', 'all'],
    queryFn: () => api<Paged<{ id: string; name: string }>>('/clients?pageSize=100'),
  });
  const { data: owners } = useQuery({
    queryKey: ['users', 'internal'],
    queryFn: () => api<{ id: string; name: string }[]>('/users?type=INTERNAL'),
  });

  function submit() {
    if (!title.trim() || (isLead && !leadName.trim()) || (!isLead && !clientId)) {
      toast.error('Preencha título e cliente/lead.');
      return;
    }
    create.mutate(
      {
        title: title.trim(),
        value: value ? Number(value) : undefined,
        ownerId,
        ...(isLead
          ? { leadName: leadName.trim(), leadCompany: leadCompany.trim() || undefined, leadPhone: leadPhone.trim() || undefined, leadEmail: leadEmail.trim() || undefined }
          : { clientId }),
      },
      {
        onSuccess: (created) => {
          toast.success('Oportunidade criada.');
          onCreated(created.id);
        },
        onError: onErr,
      },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Button variant={isLead ? 'default' : 'outline'} className="h-8" onClick={() => setIsLead(true)}>
          Lead novo
        </Button>
        <Button variant={!isLead ? 'default' : 'outline'} className="h-8" onClick={() => setIsLead(false)}>
          Cliente existente
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="op-title">Título</Label>
        <Input id="op-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      {isLead ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="op-lead-name">Nome</Label>
            <Input id="op-lead-name" value={leadName} onChange={(e) => setLeadName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="op-lead-company">Empresa</Label>
            <Input id="op-lead-company" value={leadCompany} onChange={(e) => setLeadCompany(e.target.value)} />
          </div>
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="op-lead-phone">Telefone</Label>
              <Input id="op-lead-phone" value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="op-lead-email">E-mail</Label>
              <Input id="op-lead-email" type="email" value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)} />
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label>Cliente</Label>
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Selecione…</option>
            {clients?.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="op-value">Valor estimado (R$)</Label>
          <Input id="op-value" type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Responsável</Label>
          <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            {owners?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Button className="h-9 self-start" disabled={create.isPending} onClick={submit}>
        Criar oportunidade
      </Button>
    </div>
  );
}
