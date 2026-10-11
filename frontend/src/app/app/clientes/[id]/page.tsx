'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import type { Paged, PublicUser } from '@/lib/tickets';
import {
  ASSET_STATUS_LABELS,
  type Asset,
  type AssetStatus,
} from '@/lib/assets';
import { CONTRACT_STATUS_LABELS, useContracts } from '@/lib/contracts';
import { STAGE_LABELS, useOpportunities } from '@/lib/crm';
import { ClientForm, type ClientValues } from '@/components/client-form';
import { ContactForm, type ContactValues } from '@/components/contact-form';
import { LocationForm, type LocationValues } from '@/components/location-form';
import { AssetForm, type AssetFormPayload } from '@/components/asset-form';
import { TicketTable } from '@/components/ticket-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs } from '@/components/ui/tabs';

interface Client {
  id: string;
  name: string;
  cnpj: string | null;
  emailDomains: string[];
  notes: string | null;
  active: boolean;
}

interface Location {
  id: string;
  name: string;
  address: string | null;
  active: boolean;
}

const STATUS_TONE: Record<AssetStatus, 'green' | 'amber' | 'neutral'> = {
  ACTIVE: 'green',
  MAINTENANCE: 'amber',
  INACTIVE: 'neutral',
};

const ROLE_LABELS: Record<string, string> = { MANAGER: 'Gestor', CONTACT: 'Contato' };

function errToast(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
}

function ContactsTab({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingPhone, setEditingPhone] = useState<PublicUser | null>(null);
  const [phoneValue, setPhoneValue] = useState('');

  const { data: contacts } = useQuery({
    queryKey: ['contacts', clientId],
    queryFn: () => api<PublicUser[]>(`/clients/${clientId}/contacts`),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['contacts', clientId] });

  const create = useMutation({
    mutationFn: (v: ContactValues) =>
      api(`/clients/${clientId}/contacts`, { method: 'POST', body: v }),
    onSuccess: () => {
      invalidate();
      setAdding(false);
      toast.success('Contato criado. Convite enviado.');
    },
    onError: errToast,
  });

  const setActive = useMutation({
    mutationFn: (v: { id: string; active: boolean }) =>
      api(`/users/${v.id}`, { method: 'PATCH', body: { active: v.active } }),
    onSuccess: () => {
      invalidate();
      toast.success('Contato atualizado.');
    },
    onError: errToast,
  });

  const savePhone = useMutation({
    mutationFn: (v: { id: string; phone: string }) =>
      api(`/users/${v.id}`, { method: 'PATCH', body: { phone: v.phone } }),
    onSuccess: () => {
      invalidate();
      setEditingPhone(null);
      toast.success('Telefone atualizado.');
    },
    onError: errToast,
  });

  const resend = useMutation({
    mutationFn: (email: string) =>
      api('/auth/forgot-password', { method: 'POST', body: { email } }),
    onSuccess: () => toast.success('Convite reenviado.'),
    onError: errToast,
  });

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex justify-end">
        <Button onClick={() => setAdding(true)}>Novo contato</Button>
      </div>
      <Dialog open={adding} onClose={() => setAdding(false)} title="Novo contato">
        <ContactForm
          busy={create.isPending}
          onSubmit={(v) => create.mutate(v)}
          onCancel={() => setAdding(false)}
        />
      </Dialog>
      <Dialog open={!!editingPhone} onClose={() => setEditingPhone(null)} title="Telefone do contato">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Usado para reconhecer quem escreve nos grupos de WhatsApp. {editingPhone?.name}
          </p>
          <Input
            aria-label="Telefone"
            placeholder="(19) 99999-1234"
            value={phoneValue}
            onChange={(e) => setPhoneValue(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              disabled={savePhone.isPending}
              onClick={() => editingPhone && savePhone.mutate({ id: editingPhone.id, phone: phoneValue })}
            >
              Salvar
            </Button>
            <Button variant="outline" onClick={() => setEditingPhone(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      </Dialog>
      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Nome</th>
              <th className="px-3 py-2 font-medium">E-mail</th>
              <th className="px-3 py-2 font-medium">Telefone</th>
              <th className="px-3 py-2 font-medium">Papel</th>
              <th className="px-3 py-2 font-medium">Situação</th>
              <th className="px-3 py-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {contacts?.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="px-3 py-2">{c.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{c.email}</td>
                <td className="px-3 py-2 text-muted-foreground">{c.phone ?? '—'}</td>
                <td className="px-3 py-2">{ROLE_LABELS[c.role] ?? c.role}</td>
                <td className="px-3 py-2">
                  <Badge tone={c.active ? 'green' : 'neutral'}>
                    {c.active ? 'Ativo' : 'Inativo'}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => {
                        setEditingPhone(c);
                        setPhoneValue(c.phone ?? '');
                      }}
                    >
                      Telefone
                    </button>
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => resend.mutate(c.email)}
                    >
                      Reenviar convite
                    </button>
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => setActive.mutate({ id: c.id, active: !c.active })}
                    >
                      {c.active ? 'Desativar' : 'Ativar'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {contacts && contacts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhum contato.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LocationsTab({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const { data } = useQuery({
    queryKey: ['locations', clientId],
    queryFn: () =>
      api<Paged<Location>>(`/locations?clientId=${clientId}&pageSize=100`),
  });

  // Prefixo amplo: casa tanto ['locations', clientId] (pickers de chamado) quanto
  // ['locations', 'options', clientId] (picker do form de ativo nesta mesma página).
  const invalidate = () => qc.invalidateQueries({ queryKey: ['locations'] });

  const create = useMutation({
    mutationFn: (v: LocationValues) =>
      api('/locations', { method: 'POST', body: { clientId, ...v } }),
    onSuccess: () => {
      invalidate();
      setAdding(false);
      toast.success('Local criado.');
    },
    onError: errToast,
  });

  const setActive = useMutation({
    mutationFn: (v: { id: string; active: boolean }) =>
      api(`/locations/${v.id}`, { method: 'PATCH', body: { active: v.active } }),
    onSuccess: () => {
      invalidate();
      toast.success('Local atualizado.');
    },
    onError: errToast,
  });

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex justify-end">
        <Button onClick={() => setAdding(true)}>Novo local</Button>
      </div>
      <Dialog open={adding} onClose={() => setAdding(false)} title="Novo local">
        <LocationForm
          submitLabel="Criar local"
          busy={create.isPending}
          onSubmit={(v) => create.mutate(v)}
          onCancel={() => setAdding(false)}
        />
      </Dialog>
      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Nome</th>
              <th className="px-3 py-2 font-medium">Endereço</th>
              <th className="px-3 py-2 font-medium">Situação</th>
              <th className="px-3 py-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {data?.data.map((l) => (
              <tr key={l.id} className="border-t border-border">
                <td className="px-3 py-2">{l.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{l.address ?? '—'}</td>
                <td className="px-3 py-2">
                  <Badge tone={l.active ? 'green' : 'neutral'}>
                    {l.active ? 'Ativo' : 'Inativo'}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => setActive.mutate({ id: l.id, active: !l.active })}
                  >
                    {l.active ? 'Desativar' : 'Ativar'}
                  </button>
                </td>
              </tr>
            ))}
            {data && data.data.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhum local.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ClientAssetsTab({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const { data } = useQuery({
    queryKey: ['assets', 'client', clientId],
    queryFn: () =>
      api<Paged<Asset>>(`/assets?clientId=${clientId}&pageSize=100`),
  });

  const create = useMutation({
    mutationFn: (v: AssetFormPayload) => api<Asset>('/assets', { method: 'POST', body: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      setAdding(false);
      toast.success('Ativo criado.');
    },
    onError: errToast,
  });

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex justify-end">
        <Button onClick={() => setAdding(true)}>Novo ativo</Button>
      </div>
      <Dialog open={adding} onClose={() => setAdding(false)} title="Novo ativo">
        <AssetForm
          lockedClientId={clientId}
          submitLabel="Criar ativo"
          busy={create.isPending}
          onSubmit={(v) => create.mutate(v)}
          onCancel={() => setAdding(false)}
        />
      </Dialog>
      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Identificação</th>
              <th className="px-3 py-2 font-medium">Tipo</th>
              <th className="px-3 py-2 font-medium">Local</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.data.map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <Link
                    href={`/app/ativos/${a.id}`}
                    className="text-primary hover:underline"
                  >
                    {a.label}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{a.type?.name ?? '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {a.location?.name ?? '—'}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={STATUS_TONE[a.status]}>
                    {ASSET_STATUS_LABELS[a.status]}
                  </Badge>
                </td>
              </tr>
            ))}
            {data && data.data.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhum ativo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ContractsTab({ clientId }: { clientId: string }) {
  const { data: contracts } = useContracts({ clientId });
  return (
    <div className="flex max-w-xl flex-col gap-3 pt-4">
      <Link href={`/app/contratos?novoContrato=1&clientId=${clientId}`}>
        <Button className="h-9">Novo contrato</Button>
      </Link>
      <ul className="flex flex-col gap-1">
        {contracts?.map((c) => (
          <li key={c.id}>
            <Link
              href={`/app/contratos/${c.id}`}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
            >
              <span className="font-medium">{c.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">{CONTRACT_STATUS_LABELS[c.status]}</span>
            </Link>
          </li>
        ))}
        {contracts?.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum contrato.</p>
        )}
      </ul>
    </div>
  );
}

function OpportunitiesTab({ clientId }: { clientId: string }) {
  const { data: opportunities } = useOpportunities({ clientId });
  return (
    <div className="flex max-w-xl flex-col gap-3 pt-4">
      <ul className="flex flex-col gap-1">
        {opportunities?.map((o) => (
          <li key={o.id}>
            <Link
              href={`/app/crm/${o.id}`}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
            >
              <span className="font-medium">{o.title}</span>
              <span className="ml-auto text-xs text-muted-foreground">{STAGE_LABELS[o.stage]}</span>
            </Link>
          </li>
        ))}
        {opportunities?.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma oportunidade.</p>
        )}
      </ul>
    </div>
  );
}

export default function ClientDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const qc = useQueryClient();
  const [tab, setTab] = useState('dados');

  const { data: client, isLoading } = useQuery({
    queryKey: ['client', id],
    queryFn: () => api<Client>(`/clients/${id}`),
  });

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<Client>(`/clients/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client', id] });
      qc.invalidateQueries({ queryKey: ['clients'] });
      toast.success('Cliente atualizado.');
    },
    onError: errToast,
  });

  if (isLoading || !client)
    return <p className="text-sm text-muted-foreground">Carregando…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">{client.name}</h1>
        <Badge tone={client.active ? 'green' : 'neutral'}>
          {client.active ? 'Ativo' : 'Inativo'}
        </Badge>
        <Button
          variant="outline"
          className="h-8"
          onClick={() => update.mutate({ active: !client.active })}
        >
          {client.active ? 'Desativar' : 'Ativar'}
        </Button>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'dados', label: 'Dados' },
          { value: 'contatos', label: 'Contatos' },
          { value: 'locais', label: 'Locais' },
          { value: 'ativos', label: 'Ativos' },
          { value: 'contratos', label: 'Contratos' },
          { value: 'oportunidades', label: 'Oportunidades' },
          { value: 'chamados', label: 'Chamados' },
        ]}
      />

      {tab === 'dados' && (
        <div className="max-w-xl pt-4">
          <ClientForm
            initial={{
              name: client.name,
              cnpj: client.cnpj ?? '',
              emailDomains: client.emailDomains,
              notes: client.notes ?? '',
            }}
            submitLabel="Salvar alterações"
            busy={update.isPending}
            onSubmit={(v: ClientValues) =>
              update.mutate({
                name: v.name,
                cnpj: v.cnpj,
                emailDomains: v.emailDomains,
                notes: v.notes,
              })
            }
          />
        </div>
      )}

      {tab === 'contatos' && <ContactsTab clientId={id} />}

      {tab === 'locais' && <LocationsTab clientId={id} />}

      {tab === 'ativos' && <ClientAssetsTab clientId={id} />}

      {tab === 'contratos' && <ContractsTab clientId={id} />}

      {tab === 'oportunidades' && <OpportunitiesTab clientId={id} />}

      {tab === 'chamados' && (
        <div className="pt-4">
          <TicketTable clientId={id} />
        </div>
      )}
    </div>
  );
}
