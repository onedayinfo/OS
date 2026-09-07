'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { PRIORITY_LABELS, type TicketPriority } from '@/lib/tickets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface Category {
  id: string;
  name: string;
}

export default function PortalNewTicketPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('MEDIUM');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/categories'),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      toast.error('Preencha título e descrição.');
      return;
    }
    setBusy(true);
    try {
      // O backend deriva cliente/solicitante/origin do token; só mandamos o essencial.
      const ticket = await api<{ id: string }>('/tickets', {
        method: 'POST',
        body: {
          title: title.trim(),
          description: description.trim(),
          categoryId: categoryId || undefined,
          priority,
        },
      });
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        await api(`/tickets/${ticket.id}/attachments`, { method: 'POST', body: fd });
      }
      toast.success('Chamado aberto.');
      await qc.invalidateQueries({ queryKey: ['tickets'] });
      router.replace(`/portal/chamados/${ticket.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao abrir o chamado.');
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-lg font-semibold">Abrir chamado</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
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
            <Label>Prioridade sugerida</Label>
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
          <Label htmlFor="files">Anexos (opcional)</Label>
          <input
            id="files"
            ref={fileInput}
            type="file"
            multiple
            className="text-sm"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? 'Abrindo…' : 'Abrir chamado'}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}
