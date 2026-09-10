'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { PRIORITY_LABELS, type PublicUser, type TicketPriority } from '@/lib/tickets';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Tabs } from '@/components/ui/tabs';
import { useSession } from '@/lib/auth';
import type { AssetType } from '@/lib/assets';
import EmailTab from './tabs/email-tab';
import StorageTab from './tabs/storage-tab';
import AppearanceTab from './tabs/appearance-tab';
import BackupTab from './tabs/backup-tab';

function errToast(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
}

interface Category {
  id: string;
  name: string;
  active: boolean;
}
interface SlaRow {
  priority: TicketPriority;
  hours: number;
}

function CategoriesTab() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['categories'] });

  const { data } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/categories'),
  });
  const create = useMutation({
    mutationFn: (n: string) => api('/categories', { method: 'POST', body: { name: n } }),
    onSuccess: () => {
      invalidate();
      setName('');
      toast.success('Categoria criada.');
    },
    onError: errToast,
  });
  const patch = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) =>
      api(`/categories/${v.id}`, { method: 'PATCH', body: v.body }),
    onSuccess: () => {
      invalidate();
      toast.success('Categoria atualizada.');
    },
    onError: errToast,
  });

  return (
    <div className="flex max-w-lg flex-col gap-3 pt-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate(name.trim());
        }}
      >
        <Input
          placeholder="Nova categoria"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={create.isPending}>
          Adicionar
        </Button>
      </form>
      <ul className="flex flex-col gap-1">
        {data?.map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
          >
            <input
              defaultValue={c.name}
              className="flex-1 bg-transparent text-sm outline-none"
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== c.name) patch.mutate({ id: c.id, body: { name: v } });
              }}
            />
            <Badge tone={c.active ? 'green' : 'neutral'}>
              {c.active ? 'Ativa' : 'Inativa'}
            </Badge>
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={() => patch.mutate({ id: c.id, body: { active: !c.active } })}
            >
              {c.active ? 'Desativar' : 'Ativar'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AssetTypesTab() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['asset-types'] });

  const { data } = useQuery({
    queryKey: ['asset-types'],
    queryFn: () => api<AssetType[]>('/asset-types'),
  });
  const create = useMutation({
    mutationFn: (n: string) => api('/asset-types', { method: 'POST', body: { name: n } }),
    onSuccess: () => {
      invalidate();
      setName('');
      toast.success('Tipo de ativo criado.');
    },
    onError: errToast,
  });
  const patch = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) =>
      api(`/asset-types/${v.id}`, { method: 'PATCH', body: v.body }),
    onSuccess: () => {
      invalidate();
      toast.success('Tipo de ativo atualizado.');
    },
    onError: errToast,
  });

  return (
    <div className="flex max-w-lg flex-col gap-3 pt-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate(name.trim());
        }}
      >
        <Input
          placeholder="Novo tipo de ativo"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={create.isPending}>
          Adicionar
        </Button>
      </form>
      <ul className="flex flex-col gap-1">
        {data?.map((t) => (
          <li
            key={t.id}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
          >
            <input
              defaultValue={t.name}
              className="flex-1 bg-transparent text-sm outline-none"
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== t.name) patch.mutate({ id: t.id, body: { name: v } });
              }}
            />
            <Badge tone={t.active ? 'green' : 'neutral'}>
              {t.active ? 'Ativo' : 'Inativo'}
            </Badge>
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={() => patch.mutate({ id: t.id, body: { active: !t.active } })}
            >
              {t.active ? 'Desativar' : 'Ativar'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SlaTab() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['sla'], queryFn: () => api<SlaRow[]>('/sla') });
  const patch = useMutation({
    mutationFn: (v: { priority: string; hours: number }) =>
      api(`/sla/${v.priority}`, { method: 'PATCH', body: { hours: v.hours } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sla'] });
      toast.success('SLA atualizado.');
    },
    onError: errToast,
  });

  return (
    <div className="flex max-w-md flex-col gap-2 pt-4">
      {data?.map((r) => (
        <div key={r.priority} className="flex items-center gap-3">
          <Label className="w-28">{PRIORITY_LABELS[r.priority]}</Label>
          <Input
            type="number"
            min={1}
            defaultValue={r.hours}
            className="w-28"
            onBlur={(e) => {
              const h = Number(e.target.value);
              if (h > 0 && h !== r.hours) patch.mutate({ priority: r.priority, hours: h });
            }}
          />
          <span className="text-sm text-muted-foreground">horas</span>
        </div>
      ))}
    </div>
  );
}

function UsersTab() {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    email: '',
    role: 'AGENT' as 'ADMIN' | 'AGENT',
    password: '',
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['users', 'INTERNAL'] });

  const { data } = useQuery({
    queryKey: ['users', 'INTERNAL'],
    queryFn: () => api<PublicUser[]>('/users?type=INTERNAL'),
  });
  const create = useMutation({
    mutationFn: (body: typeof form) => api('/users/internal', { method: 'POST', body }),
    onSuccess: () => {
      invalidate();
      setForm({ name: '', email: '', role: 'AGENT', password: '' });
      toast.success('Usuário criado.');
    },
    onError: errToast,
  });
  const patch = useMutation({
    mutationFn: (v: { id: string; active: boolean }) =>
      api(`/users/${v.id}`, { method: 'PATCH', body: { active: v.active } }),
    onSuccess: () => {
      invalidate();
      toast.success('Usuário atualizado.');
    },
    onError: errToast,
  });

  return (
    <div className="flex flex-col gap-4 pt-4">
      <form
        className="flex max-w-2xl flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.name.trim() && form.email.trim() && form.password.length >= 8) {
            create.mutate(form);
          } else {
            toast.error('Preencha nome, e-mail e senha (mín. 8 caracteres).');
          }
        }}
      >
        <Input
          placeholder="Nome"
          className="w-40"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
        <Input
          placeholder="E-mail"
          type="email"
          className="w-52"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
        <Select
          className="w-32"
          value={form.role}
          onChange={(e) =>
            setForm((f) => ({ ...f, role: e.target.value as 'ADMIN' | 'AGENT' }))
          }
        >
          <option value="AGENT">Agente</option>
          <option value="ADMIN">Admin</option>
        </Select>
        <Input
          placeholder="Senha inicial"
          type="password"
          className="w-40"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
        />
        <Button type="submit" disabled={create.isPending}>
          Criar
        </Button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Nome</th>
              <th className="px-3 py-2 font-medium">E-mail</th>
              <th className="px-3 py-2 font-medium">Papel</th>
              <th className="px-3 py-2 font-medium">Situação</th>
              <th className="px-3 py-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-3 py-2">{u.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{u.email}</td>
                <td className="px-3 py-2">{u.role === 'ADMIN' ? 'Admin' : 'Agente'}</td>
                <td className="px-3 py-2">
                  <Badge tone={u.active ? 'green' : 'neutral'}>
                    {u.active ? 'Ativo' : 'Inativo'}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => patch.mutate({ id: u.id, active: !u.active })}
                  >
                    {u.active ? 'Desativar' : 'Ativar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ConfigPage() {
  const [tab, setTab] = useState('categorias');
  const { user } = useSession();
  const isAdmin = user?.role === 'ADMIN';

  const tabs = [
    { value: 'categorias', label: 'Categorias' },
    { value: 'sla', label: 'SLA' },
    { value: 'usuarios', label: 'Usuários internos' },
    ...(isAdmin
      ? [
          { value: 'tipos-ativo', label: 'Tipos de ativo' },
          { value: 'email', label: 'E-mail' },
          { value: 'armazenamento', label: 'Armazenamento' },
          { value: 'aparencia', label: 'Aparência' },
          { value: 'backup', label: 'Backup' },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Configurações</h1>
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'categorias' && <CategoriesTab />}
      {tab === 'sla' && <SlaTab />}
      {tab === 'usuarios' && <UsersTab />}
      {tab === 'tipos-ativo' && isAdmin && <AssetTypesTab />}
      {tab === 'email' && isAdmin && <EmailTab />}
      {tab === 'armazenamento' && isAdmin && <StorageTab />}
      {tab === 'aparencia' && isAdmin && <AppearanceTab />}
      {tab === 'backup' && isAdmin && <BackupTab />}
    </div>
  );
}
