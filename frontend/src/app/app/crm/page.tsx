'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth';
import {
  STAGE_LABELS,
  useChangeStage,
  useFollowUps,
  useOpportunities,
  type Opportunity,
  type OpportunityStage,
} from '@/lib/crm';
import { NewOpportunityForm } from '@/components/new-opportunity-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';

const STAGES: OpportunityStage[] = ['NEW', 'CONTACTED', 'PROPOSAL', 'WON', 'LOST'];

const NEXT_STAGE: Partial<Record<OpportunityStage, OpportunityStage>> = {
  NEW: 'CONTACTED',
  CONTACTED: 'PROPOSAL',
  PROPOSAL: 'WON',
};

export default function CrmPage() {
  const router = useRouter();
  const { user } = useSession();
  const [ownerFilter, setOwnerFilter] = useState<'mine' | 'all'>('mine');
  const [showClosed, setShowClosed] = useState(false);
  const [creating, setCreating] = useState(false);

  const { data: opportunities, isLoading } = useOpportunities(
    ownerFilter === 'mine' && user ? { ownerId: user.id } : {},
  );
  const { data: followUps } = useFollowUps('overdue');

  const visibleStages = showClosed ? STAGES : STAGES.filter((s) => s !== 'WON' && s !== 'LOST');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">CRM</h1>
        <Button className="h-9" onClick={() => setCreating(true)}>
          Nova oportunidade
        </Button>
      </div>

      <Dialog open={creating} onClose={() => setCreating(false)} title="Nova oportunidade">
        {user && (
          <NewOpportunityForm
            currentUserId={user.id}
            onCreated={(id) => {
              setCreating(false);
              router.push(`/app/crm/${id}`);
            }}
          />
        )}
      </Dialog>

      {!!followUps?.length && (
        <div className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
          <p className="mb-1 font-semibold">Follow-ups atrasados</p>
          <ul className="flex flex-col gap-1">
            {followUps.map((f) => (
              <li key={f.id}>
                <Link href={`/app/crm/${f.id}`} className="hover:underline">
                  {f.title} — {f.client?.name ?? f.leadName} ({new Date(f.nextFollowUpAt).toLocaleDateString('pt-BR')})
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-2">
        <Select className="h-9 w-40" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value as 'mine' | 'all')}>
          <option value="mine">Meus</option>
          <option value="all">Todos</option>
        </Select>
        <Button variant="outline" className="h-9" onClick={() => setShowClosed((v) => !v)}>
          {showClosed ? 'Ocultar ganhos/perdidos' : 'Mostrar ganhos/perdidos'}
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        {visibleStages.map((stage) => (
          <StageColumn key={stage} stage={stage} opportunities={opportunities?.filter((o) => o.stage === stage) ?? []} />
        ))}
      </div>
    </div>
  );
}

function StageColumn({ stage, opportunities }: { stage: OpportunityStage; opportunities: Opportunity[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2">
      <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {STAGE_LABELS[stage]} ({opportunities.length})
      </h2>
      {opportunities.map((o) => (
        <OpportunityCard key={o.id} opportunity={o} />
      ))}
    </div>
  );
}

function OpportunityCard({ opportunity }: { opportunity: Opportunity }) {
  const changeStage = useChangeStage(opportunity.id);
  const next = NEXT_STAGE[opportunity.stage];
  const overdue = opportunity.nextFollowUpAt && new Date(opportunity.nextFollowUpAt) < new Date();
  const value = opportunity.quote?.total ?? opportunity.value;

  function moveToNext() {
    if (!next) return;
    if (next === 'WON' && !confirm('Marcar como Ganho? Isso cria um Cliente novo se ainda não houver um vinculado.')) {
      return;
    }
    changeStage.mutate({ stage: next });
  }

  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-background p-2 text-sm">
      <Link href={`/app/crm/${opportunity.id}`} className="font-medium hover:underline">
        {opportunity.title}
      </Link>
      <span className="text-xs text-muted-foreground">
        {opportunity.client?.name ?? opportunity.leadName}
      </span>
      <div className="flex items-center justify-between">
        <span className="text-xs">{value != null ? `R$ ${value.toFixed(2)}` : '—'}</span>
        {overdue && <Badge tone="amber">Follow-up atrasado</Badge>}
      </div>
      {next && (
        <Button
          variant="outline"
          className="h-7 self-start text-xs"
          disabled={changeStage.isPending}
          onClick={moveToNext}
        >
          Mover para {STAGE_LABELS[next]}
        </Button>
      )}
    </div>
  );
}
