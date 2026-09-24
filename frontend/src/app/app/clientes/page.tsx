'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import type { Paged } from '@/lib/tickets';
import { ClientForm, type ClientValues } from '@/components/client-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface Client {
  id: string;
  name: string;
  cnpj: string | null;
  active: boolean;
}

export default function ClientsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading } = useQuery({
    queryKey: ['clients', 'list', debouncedQ],
    queryFn: () =>
      api<Paged<Client>>(
        `/clients?pageSize=100${debouncedQ ? `&q=${encodeURIComponent(debouncedQ)}` : ''}`,
      ),
  });

  const create = useMutation({
    mutationFn: (v: ClientValues) =>
      api<Client>('/clients', {
        method: 'POST',
        body: {
          name: v.name,
          cnpj: v.cnpj || undefined,
          emailDomains: v.emailDomains,
          notes: v.notes || undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      setCreating(false);
      toast.success('Cliente criado.');
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : 'Falha ao criar o cliente.'),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Clientes</h1>
        <Button onClick={() => setCreating(true)}>Novo cliente</Button>
      </div>

      <Dialog open={creating} onClose={() => setCreating(false)} title="Novo cliente">
        <ClientForm
          submitLabel="Criar cliente"
          busy={create.isPending}
          onSubmit={(v) => create.mutate(v)}
          onCancel={() => setCreating(false)}
        />
      </Dialog>

      <Input
        placeholder="Buscar por nome"
        className="w-64"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Nome</th>
              <th className="px-3 py-2 font-medium">CNPJ</th>
              <th className="px-3 py-2 font-medium">Situação</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            )}
            {data?.data.map((c) => (
              <tr
                key={c.id}
                onClick={() => router.push(`/app/clientes/${c.id}`)}
                className="cursor-pointer border-t border-border hover:bg-accent"
              >
                <td className="px-3 py-2">{c.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{c.cnpj ?? '—'}</td>
                <td className="px-3 py-2">
                  <Badge tone={c.active ? 'green' : 'neutral'}>
                    {c.active ? 'Ativo' : 'Inativo'}
                  </Badge>
                </td>
              </tr>
            ))}
            {data && data.data.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhum cliente encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
