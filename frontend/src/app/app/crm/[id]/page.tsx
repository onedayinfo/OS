'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import {
  STAGE_LABELS,
  useAddNote,
  useChangeStage,
  useOpportunity,
  useUpdateOpportunity,
  type OpportunityStage,
} from '@/lib/crm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const STAGES: OpportunityStage[] = ['NEW', 'CONTACTED', 'PROPOSAL', 'WON', 'LOST'];

function onErr(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
}

export default function OpportunityDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { data: opportunity, isLoading } = useOpportunity(id);
  const update = useUpdateOpportunity(id);
  const changeStage = useChangeStage(id);
  const addNote = useAddNote(id);

  const [followUpAt, setFollowUpAt] = useState('');
  const [followUpNote, setFollowUpNote] = useState('');
  const [noteText, setNoteText] = useState('');
  const [pendingStage, setPendingStage] = useState<OpportunityStage | ''>('');
  const [lostReason, setLostReason] = useState('');

  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [leadName, setLeadName] = useState('');
  const [leadCompany, setLeadCompany] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [quoteId, setQuoteId] = useState('');

  const { data: owners } = useQuery({
    queryKey: ['users', 'internal'],
    queryFn: () => api<{ id: string; name: string }[]>('/users?type=INTERNAL'),
  });
  const { data: quotes } = useQuery({
    queryKey: ['quotes', opportunity?.clientId],
    queryFn: () =>
      api<{ id: string; number: number; client: { id: string; name: string } }[]>(
        `/quotes?clientId=${opportunity!.clientId}`,
      ),
    enabled: !!opportunity?.clientId,
  });

  useEffect(() => {
    if (!opportunity) return;
    setFollowUpAt(opportunity.nextFollowUpAt ? opportunity.nextFollowUpAt.slice(0, 10) : '');
    setFollowUpNote(opportunity.nextFollowUpNote ?? '');
    setTitle(opportunity.title);
    setValue(opportunity.value != null ? String(opportunity.value) : '');
    setOwnerId(opportunity.ownerId);
    setLeadName(opportunity.leadName ?? '');
    setLeadCompany(opportunity.leadCompany ?? '');
    setLeadPhone(opportunity.leadPhone ?? '');
    setLeadEmail(opportunity.leadEmail ?? '');
    setQuoteId(opportunity.quoteId ?? '');
  }, [opportunity?.id]);

  if (isLoading || !opportunity) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  function saveDetails() {
    update.mutate(
      {
        title: title.trim(),
        value: value ? Number(value) : null,
        ownerId,
        quoteId: quoteId || null,
        ...(!opportunity!.clientId && {
          leadName: leadName.trim(),
          leadCompany: leadCompany.trim() || null,
          leadPhone: leadPhone.trim() || null,
          leadEmail: leadEmail.trim() || null,
        }),
      },
      { onSuccess: () => toast.success('Dados atualizados.'), onError: onErr },
    );
  }

  function saveFollowUp() {
    update.mutate(
      {
        nextFollowUpAt: followUpAt ? new Date(`${followUpAt}T12:00:00`).toISOString() : null,
        nextFollowUpNote: followUpNote || null,
      },
      { onSuccess: () => toast.success('Follow-up atualizado.'), onError: onErr },
    );
  }

  function submitNote() {
    if (!noteText.trim()) return;
    addNote.mutate(noteText.trim(), {
      onSuccess: () => {
        setNoteText('');
        toast.success('Nota adicionada.');
      },
      onError: onErr,
    });
  }

  function applyStageChange() {
    if (!pendingStage) return;
    if (pendingStage === 'LOST' && !lostReason.trim()) {
      toast.error('Informe o motivo da perda.');
      return;
    }
    changeStage.mutate(
      { stage: pendingStage, lostReason: pendingStage === 'LOST' ? lostReason.trim() : undefined },
      {
        onSuccess: () => {
          toast.success('Estágio atualizado.');
          setPendingStage('');
          setLostReason('');
        },
        onError: onErr,
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">
            {opportunity.client?.name ?? opportunity.leadName}
          </p>
          <h1 className="text-lg font-semibold">{opportunity.title}</h1>
        </div>
        <Badge tone={opportunity.stage === 'WON' ? 'green' : opportunity.stage === 'LOST' ? 'neutral' : 'blue'}>
          {STAGE_LABELS[opportunity.stage]}
        </Badge>
      </div>

      <section className="flex max-w-xl flex-col gap-3 rounded-lg border border-border p-3 text-sm">
        <h2 className="text-sm font-semibold">Dados da oportunidade</h2>
        <div className="flex flex-col gap-1.5">
          <Label>Título</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label>Valor estimado (R$)</Label>
            <Input type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
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

        {opportunity.clientId ? (
          <div className="flex flex-col gap-1.5">
            <Label>Cliente</Label>
            <p className="text-sm">{opportunity.client?.name}</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <Label>Nome</Label>
              <Input value={leadName} onChange={(e) => setLeadName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Empresa</Label>
              <Input value={leadCompany} onChange={(e) => setLeadCompany(e.target.value)} />
            </div>
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label>Telefone</Label>
                <Input value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label>E-mail</Label>
                <Input type="email" value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)} />
              </div>
            </div>
          </>
        )}

        {opportunity.clientId && (
          <div className="flex flex-col gap-1.5">
            <Label>Orçamento vinculado</Label>
            <Select value={quoteId} onChange={(e) => setQuoteId(e.target.value)}>
              <option value="">Nenhum</option>
              {quotes?.map((q) => (
                <option key={q.id} value={q.id}>
                  #{q.number}
                </option>
              ))}
            </Select>
          </div>
        )}

        <Button variant="outline" className="h-9 self-start" disabled={update.isPending} onClick={saveDetails}>
          Salvar dados
        </Button>
      </section>

      <section className="flex max-w-xl flex-col gap-3 rounded-lg border border-border p-3 text-sm">
        <h2 className="text-sm font-semibold">Estágio</h2>
        <div className="flex items-center gap-2">
          <Select value={pendingStage} onChange={(e) => setPendingStage(e.target.value as OpportunityStage)}>
            <option value="">Mudar para…</option>
            {STAGES.filter((s) => s !== opportunity.stage).map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </Select>
          {pendingStage === 'LOST' && (
            <Input
              placeholder="Motivo da perda"
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
            />
          )}
          <Button variant="outline" className="h-9" disabled={!pendingStage || changeStage.isPending} onClick={applyStageChange}>
            Aplicar
          </Button>
        </div>
        {opportunity.quote && (
          <p className="text-xs text-muted-foreground">
            Orçamento #{opportunity.quote.number} — R$ {opportunity.quote.total.toFixed(2)}
          </p>
        )}
      </section>

      <section className="flex max-w-xl flex-col gap-3 rounded-lg border border-border p-3 text-sm">
        <h2 className="text-sm font-semibold">Próxima ação</h2>
        <div className="flex flex-col gap-1.5">
          <Label>Data</Label>
          <Input type="date" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Nota</Label>
          <Input value={followUpNote} onChange={(e) => setFollowUpNote(e.target.value)} />
        </div>
        <Button variant="outline" className="h-9 self-start" disabled={update.isPending} onClick={saveFollowUp}>
          Salvar follow-up
        </Button>
      </section>

      <section className="flex max-w-xl flex-col gap-3">
        <h2 className="text-sm font-semibold">Timeline de notas</h2>
        <div className="flex flex-col gap-2">
          <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Nova nota…" />
          <Button variant="outline" className="h-9 self-start" disabled={addNote.isPending} onClick={submitNote}>
            Adicionar nota
          </Button>
        </div>
        <ul className="flex flex-col gap-2">
          {opportunity.notes?.map((n) => (
            <li key={n.id} className="rounded-md border border-border p-2 text-sm">
              <p>{n.text}</p>
              <p className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString('pt-BR')}</p>
            </li>
          ))}
          {!opportunity.notes?.length && <p className="text-sm text-muted-foreground">Nenhuma nota ainda.</p>}
        </ul>
      </section>
    </div>
  );
}
