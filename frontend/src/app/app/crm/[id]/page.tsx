'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
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

  useEffect(() => {
    if (!opportunity) return;
    setFollowUpAt(opportunity.nextFollowUpAt ? opportunity.nextFollowUpAt.slice(0, 10) : '');
    setFollowUpNote(opportunity.nextFollowUpNote ?? '');
  }, [opportunity]);

  if (isLoading || !opportunity) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  function saveFollowUp() {
    update.mutate(
      {
        nextFollowUpAt: followUpAt ? new Date(followUpAt).toISOString() : null,
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
