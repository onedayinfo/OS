'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import {
  PRIORITY_LABELS,
  type Paged,
  type PublicUser,
  type TicketPriority,
} from '@/lib/tickets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface Category {
  id: string;
  name: string;
}

export default function NewTicketPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [clientId, setClientId] = useState('');
  const [requesterId, setRequesterId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('MEDIUM');
  const [equipment, setEquipment] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: clients } = useQuery({
    queryKey: ['clients', 'all'],
    queryFn: () => api<Paged<{ id: string; name: string }>>('/clients?pageSize=100'),
  });
  const { data: contacts } = useQuery({
    queryKey: ['contacts', clientId],
    queryFn: () => api<PublicUser[]>(`/clients/${clientId}/contacts`),
    enabled: !!clientId,
  });
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/categories'),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId || !requesterId || !title.trim() || !description.trim()) {
      toast.error('Preencha cliente, solicitante, título e descrição.');
      return;
    }
    setBusy(true);
    try {
      const ticket = await api<{ id: string }>('/tickets', {
        method: 'POST',
        body: {
          title: title.trim(),
          description: description.trim(),
          clientId,
          requesterId,
          categoryId: categoryId || undefined,
          priority,
          equipment: equipment.trim() || undefined,
        },
      });
      toast.success('Chamado criado.');
      await qc.invalidateQueries({ queryKey: ['tickets'] });
      router.replace(`/app/chamados/${ticket.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao criar o chamado.');
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-lg font-semibold">Novo chamado</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Cliente</Label>
          <Select
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setRequesterId('');
            }}
          >
            <option value="">Selecione</option>
            {clients?.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Solicitante</Label>
          <Select
            value={requesterId}
            onChange={(e) => setRequesterId(e.target.value)}
            disabled={!clientId}
          >
            <option value="">Selecione</option>
            {contacts?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.email})
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="title">Título</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="desc">Descrição</Label>
          <Textarea
            id="desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex gap-4">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label>Categoria</Label>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Nenhuma</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label>Prioridade</Label>
            <Select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TicketPriority)}
            >
              {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="equip">Equipamento</Label>
          <Input
            id="equip"
            value={equipment}
            onChange={(e) => setEquipment(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? 'Criando…' : 'Criar chamado'}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}
