'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import type { PublicUser } from '@/lib/tickets';
import { ClientForm, type ClientValues } from '@/components/client-form';
import { ContactForm, type ContactValues } from '@/components/contact-form';
import { TicketTable } from '@/components/ticket-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';

interface Client {
  id: string;
  name: string;
  cnpj: string | null;
  emailDomains: string[];
  notes: string | null;
  active: boolean;
}

const ROLE_LABELS: Record<string, string> = { MANAGER: 'Gestor', CONTACT: 'Contato' };

function errToast(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
}

function ContactsTab({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

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

  const resend = useMutation({
    mutationFn: (email: string) =>
      api('/auth/forgot-password', { method: 'POST', body: { email } }),
    onSuccess: () => toast.success('Convite reenviado.'),
    onError: errToast,
  });

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex justify-end">
        <Button onClick={() => setAdding((v) => !v)}>
          {adding ? 'Fechar' : 'Novo contato'}
        </Button>
      </div>
      {adding && (
        <ContactForm
          busy={create.isPending}
          onSubmit={(v) => create.mutate(v)}
          onCancel={() => setAdding(false)}
        />
      )}
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
            {contacts?.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="px-3 py-2">{c.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{c.email}</td>
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
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
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

      {tab === 'chamados' && (
        <div className="pt-4">
          <TicketTable clientId={id} />
        </div>
      )}
    </div>
  );
}
