'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { VISIT_STATUS_LABELS, useVisits, type Visit } from '@/lib/visits';

function statusTone(s: Visit['status']) {
  return s === 'DONE' ? 'green' : s === 'IN_PROGRESS' ? 'amber' : s === 'CANCELLED' ? 'neutral' : 'blue';
}

export default function CampoPage() {
  const [date] = useState(() => new Date().toISOString().slice(0, 10));
  const { data: visits, isLoading } = useVisits({ technicianId: 'me', date });

  return (
    <div className="flex flex-col gap-3 p-3">
      <h1 className="text-lg font-semibold">Minhas visitas de hoje</h1>
      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {!isLoading && (visits?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma visita hoje.</p>
      )}
      <ul className="flex flex-col gap-2">
        {visits?.map((v) => (
          <li key={v.id}>
            <Link
              href={`/app/campo/${v.id}`}
              className="flex flex-col gap-1 rounded-lg border border-border p-3 active:bg-accent"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm">
                  {new Date(v.scheduledStart).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <Badge tone={statusTone(v.status)}>{VISIT_STATUS_LABELS[v.status]}</Badge>
              </div>
              <span className="text-sm font-medium">#{v.ticket.number} — {v.ticket.title}</span>
              <span className="text-xs text-muted-foreground">
                {v.ticket.client?.name} {v.ticket.location?.name ? `· ${v.ticket.location.name}` : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
