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

interface CategorySlaOverride {
  priority: TicketPriority;
  hours: number;
}
interface Category {
  id: string;
  name: string;
  active: boolean;
  slaOverrides: CategorySlaOverride[];
}

const CATEGORY_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
interface SlaRow {
  priority: TicketPriority;
  hours: number;
}

function CategoryRow({
  c,
  onPatch,
}: {
  c: Category;
  onPatch: (body: Record<string, unknown>) => void;
}) {
  const [slaHours, setSlaHours] = useState<Record<string, string>>(() => {
    const overrides: Record<string, string> = {};
    for (const o of c.slaOverrides) overrides[o.priority] = String(o.hours);
    return overrides;
  });

  function saveSla() {
    const overrides = CATEGORY_PRIORITIES.filter((p) => slaHours[p]?.trim()).map((p) => ({
      priority: p,
      hours: Number(slaHours[p]),
    }));
    onPatch({ slaOverrides: overrides });
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <input
          defaultValue={c.name}
          className="flex-1 bg-transparent text-sm outline-none"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== c.name) onPatch({ name: v });
          }}
        />
        <Badge tone={c.active ? 'green' : 'neutral'}>
          {c.active ? 'Ativa' : 'Inativa'}
        </Badge>
        <button
          type="button"
          className="text-sm text-primary hover:underline"
          onClick={() => onPatch({ active: !c.active })}
        >
          {c.active ? 'Desativar' : 'Ativar'}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-2">
        <span className="text-xs uppercase text-muted-foreground">SLA</span>
        {CATEGORY_PRIORITIES.map((p) => (
          <label key={p} className="flex items-center gap-1.5 text-xs">
            {PRIORITY_LABELS[p]}
            <Input
              type="number"
              min={1}
              placeholder="global"
              className="h-7 w-16"
              value={slaHours[p] ?? ''}
              onChange={(e) => setSlaHours((prev) => ({ ...prev, [p]: e.target.value }))}
            />
          </label>
        ))}
        <Button variant="outline" className="h-7 text-xs" onClick={saveSla}>
          Salvar SLA
        </Button>
      </div>
    </li>
  );
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
      <ul className="flex flex-col gap-2">
        {data?.map((c) => (
          <CategoryRow
            key={c.id}
            c={c}
            onPatch={(body) => patch.mutate({ id: c.id, body })}
          />
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

interface ChecklistTemplateItemRow {
  id: string;
  label: string;
  order: number;
}
interface ChecklistTemplateRow {
  id: string;
  categoryId: string | null;
  name: string;
  active: boolean;
  items: ChecklistTemplateItemRow[];
}

function ChecklistTemplatesTab() {
  const qc = useQueryClient();
  const [newItemLabel, setNewItemLabel] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ categoryId: '', name: '' });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['checklist-templates'] });

  const { data } = useQuery({
    queryKey: ['checklist-templates'],
    queryFn: () => api<ChecklistTemplateRow[]>('/checklist-templates'),
  });
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/categories'),
  });
  const create = useMutation({
    mutationFn: () =>
      api('/checklist-templates', {
        method: 'POST',
        body: { categoryId: form.categoryId || undefined, name: form.name, items: [{ label: 'Item 1' }] },
      }),
    onSuccess: () => {
      invalidate();
      setForm({ categoryId: '', name: '' });
      toast.success('Checklist criado.');
    },
    onError: errToast,
  });
  const addItem = useMutation({
    mutationFn: (v: { template: ChecklistTemplateRow; label: string }) =>
      api(`/checklist-templates/${v.template.id}`, {
        method: 'PATCH',
        body: { items: [...v.template.items.map((i) => ({ id: i.id, label: i.label, order: i.order })), { label: v.label }] },
      }),
    onSuccess: () => {
      invalidate();
      toast.success('Item adicionado.');
    },
    onError: errToast,
  });
  const toggleActive = useMutation({
    mutationFn: (v: { id: string; active: boolean }) =>
      api(`/checklist-templates/${v.id}`, { method: 'PATCH', body: { active: v.active } }),
    onSuccess: () => {
      invalidate();
      toast.success('Checklist atualizado.');
    },
    onError: errToast,
  });

  const categoryName = (id: string | null) => categories?.find((c) => c.id === id)?.name ?? 'Padrão (sem categoria)';

  return (
    <div className="flex max-w-2xl flex-col gap-4 pt-4">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.name.trim()) create.mutate();
        }}
      >
        <Select
          className="h-9 w-48"
          value={form.categoryId}
          onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
        >
          <option value="">Sem categoria (padrão)</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Input
          placeholder="Nome do checklist"
          className="h-9 w-56"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
        <Button type="submit" className="h-9" disabled={create.isPending}>
          Novo checklist
        </Button>
      </form>

      {data?.map((t) => (
        <div key={t.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{t.name}</span>
            <Badge tone="neutral">{categoryName(t.categoryId)}</Badge>
            <button
              type="button"
              className="ml-auto text-sm text-primary hover:underline"
              onClick={() => toggleActive.mutate({ id: t.id, active: !t.active })}
            >
              {t.active ? 'Desativar' : 'Ativar'}
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {t.items.map((i) => (
              <li key={i.id} className="text-sm text-muted-foreground">
                • {i.label}
              </li>
            ))}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const label = (newItemLabel[t.id] ?? '').trim();
              if (label) {
                addItem.mutate({ template: t, label });
                setNewItemLabel((prev) => ({ ...prev, [t.id]: '' }));
              }
            }}
          >
            <Input
              placeholder="Novo item"
              className="h-8 text-sm"
              value={newItemLabel[t.id] ?? ''}
              onChange={(e) => setNewItemLabel((prev) => ({ ...prev, [t.id]: e.target.value }))}
            />
            <Button type="submit" className="h-8">
              Adicionar item
            </Button>
          </form>
        </div>
      ))}
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
          { value: 'checklists', label: 'Checklists' },
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
      {tab === 'checklists' && isAdmin && <ChecklistTemplatesTab />}
      {tab === 'email' && isAdmin && <EmailTab />}
      {tab === 'armazenamento' && isAdmin && <StorageTab />}
      {tab === 'aparencia' && isAdmin && <AppearanceTab />}
      {tab === 'backup' && isAdmin && <BackupTab />}
    </div>
  );
}
