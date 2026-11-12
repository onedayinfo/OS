'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import type { Paged } from '@/lib/tickets';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

interface Integration {
  id: string;
  name: string;
  active: boolean;
  lastEventAt: string | null;
  client: { id: string; name: string };
  category: { id: string; name: string } | null;
  token?: string;
}
type Option = { id: string; name: string };

const errToast = (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');

function TokenBox({ integ, onClose }: { integ: Integration; onClose: () => void }) {
  const url = `${window.location.origin}/api/integrations/events`;
  const curl = `curl -X POST ${url} \\
  -H "Authorization: Bearer ${integ.token}" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Servidor sem resposta","severity":"high","externalId":"srv01-ping"}'`;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
      <p className="font-medium">
        Token de &quot;{integ.name}&quot; — copie agora, ele não será mostrado de novo.
      </p>
      <code className="break-all rounded bg-muted px-2 py-1 text-xs">{integ.token}</code>
      <p className="text-xs text-muted-foreground">URL: {url}</p>
      <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{curl}</pre>
      <p className="text-xs text-muted-foreground">
        Campos: <b>title</b> (obrigatório), description, severity (low|medium|high|urgent),
        externalId (evita chamado duplicado enquanto o anterior estiver aberto), assetSerial
        (nº de série do ativo do cliente).
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="h-7 text-xs"
          onClick={() =>
            navigator.clipboard.writeText(integ.token ?? '').then(() => toast.success('Token copiado.'))
          }
        >
          Copiar token
        </Button>
        <Button variant="outline" className="h-7 text-xs" onClick={onClose}>
          Fechar
        </Button>
      </div>
    </div>
  );
}

export default function IntegrationsTab() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', clientId: '', categoryId: '' });
  const [shown, setShown] = useState<Integration | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['integrations'] });

  const { data } = useQuery({
    queryKey: ['integrations'],
    queryFn: () => api<Integration[]>('/integrations'),
  });
  const { data: clients } = useQuery({
    queryKey: ['clients', 'picker'],
    queryFn: () => api<Paged<Option>>('/clients?pageSize=100'),
  });
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<(Option & { active: boolean })[]>('/categories'),
  });

  const create = useMutation({
    mutationFn: () =>
      api<Integration>('/integrations', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          clientId: form.clientId,
          ...(form.categoryId ? { categoryId: form.categoryId } : {}),
        },
      }),
    onSuccess: (row) => {
      invalidate();
      setShown(row);
      setForm({ name: '', clientId: '', categoryId: '' });
    },
    onError: errToast,
  });
  const patch = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) =>
      api(`/integrations/${v.id}`, { method: 'PATCH', body: v.body }),
    onSuccess: invalidate,
    onError: errToast,
  });
  const regen = useMutation({
    mutationFn: (id: string) => api<Integration>(`/integrations/${id}/token`, { method: 'POST' }),
    onSuccess: (row) => {
      invalidate();
      setShown(row);
    },
    onError: errToast,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/integrations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate();
      toast.success('Integração excluída.');
    },
    onError: errToast,
  });

  return (
    <div className="flex max-w-2xl flex-col gap-4 pt-4">
      <p className="text-sm text-muted-foreground">
        Sistemas e dispositivos externos (monitoramento, central de alarme, NVR, scripts) abrem
        chamados com um <code>POST</code> JSON. Cada integração tem token próprio e cliente fixo.
      </p>

      {shown?.token && <TokenBox integ={shown} onClose={() => setShown(null)} />}

      <form
        className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.name.trim() && form.clientId) create.mutate();
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="integ-name">Nome</Label>
          <Input
            id="integ-name"
            placeholder="Zabbix — Cliente X"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="integ-client">Cliente</Label>
          <Select
            id="integ-client"
            value={form.clientId}
            onChange={(e) => setForm({ ...form, clientId: e.target.value })}
          >
            <option value="">Selecione…</option>
            {clients?.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="integ-cat">Categoria padrão</Label>
          <Select
            id="integ-cat"
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
          >
            <option value="">Sem categoria</option>
            {categories
              ?.filter((c) => c.active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Select>
        </div>
        <div className="sm:col-span-3">
          <Button type="submit" disabled={create.isPending || !form.name.trim() || !form.clientId}>
            Criar integração
          </Button>
        </div>
      </form>

      <ul className="flex flex-col gap-2">
        {data?.length === 0 && (
          <li className="text-sm text-muted-foreground">Nenhuma integração cadastrada.</li>
        )}
        {data?.map((i) => (
          <li
            key={i.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 text-sm"
          >
            <span className="font-medium">{i.name}</span>
            <span className="text-muted-foreground">
              {i.client.name}
              {i.category ? ` · ${i.category.name}` : ''}
            </span>
            <Badge tone={i.active ? 'green' : 'neutral'}>{i.active ? 'Ativa' : 'Inativa'}</Badge>
            <span className="text-xs text-muted-foreground">
              Último evento:{' '}
              {i.lastEventAt ? new Date(i.lastEventAt).toLocaleString('pt-BR') : 'nunca'}
            </span>
            <span className="ml-auto flex gap-3">
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => patch.mutate({ id: i.id, body: { active: !i.active } })}
              >
                {i.active ? 'Desativar' : 'Ativar'}
              </button>
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => {
                  if (confirm(`Gerar novo token para "${i.name}"? O token atual para de funcionar.`))
                    regen.mutate(i.id);
                }}
              >
                Novo token
              </button>
              <button
                type="button"
                className="text-destructive hover:underline"
                onClick={() => {
                  if (confirm(`Excluir a integração "${i.name}"? Os chamados já abertos ficam.`))
                    remove.mutate(i.id);
                }}
              >
                Excluir
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
