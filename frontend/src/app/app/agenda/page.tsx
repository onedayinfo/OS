'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { type PublicUser, type Paged, type TicketListItem } from '@/lib/tickets';
import {
  VISIT_STATUS_LABELS,
  useCancelVisit,
  useRescheduleVisit,
  useScheduleVisit,
  useVisits,
  type Visit,
} from '@/lib/visits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

function onErr(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
}

function statusTone(s: Visit['status']) {
  return s === 'DONE' ? 'green' : s === 'IN_PROGRESS' ? 'amber' : s === 'CANCELLED' ? 'neutral' : 'blue';
}

function ScheduleForm({ onDone }: { onDone: () => void }) {
  const [ticketId, setTicketId] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [date, setDate] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const schedule = useScheduleVisit();

  const { data: tickets } = useQuery({
    queryKey: ['tickets', 'agenda-picker'],
    queryFn: () => api<Paged<TicketListItem>>('/tickets?pageSize=50'),
  });
  const { data: agents } = useQuery({
    queryKey: ['users', 'INTERNAL'],
    queryFn: () => api<PublicUser[]>('/users?type=INTERNAL'),
  });

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ticketId || !technicianId || !date) {
          toast.error('Preencha chamado, técnico e data.');
          return;
        }
        schedule.mutate(
          {
            ticketId,
            technicianId,
            scheduledStart: new Date(`${date}T${start}:00`).toISOString(),
            scheduledEnd: new Date(`${date}T${end}:00`).toISOString(),
          },
          {
            onSuccess: () => {
              toast.success('Visita agendada.');
              onDone();
            },
            onError: onErr,
          },
        );
      }}
    >
      <Select className="h-9 w-56" value={ticketId} onChange={(e) => setTicketId(e.target.value)}>
        <option value="">Chamado…</option>
        {tickets?.data.map((t) => (
          <option key={t.id} value={t.id}>
            #{t.number} {t.title}
          </option>
        ))}
      </Select>
      <Select className="h-9 w-40" value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
        <option value="">Técnico…</option>
        {agents?.filter((a) => a.role === 'AGENT' && a.active).map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
      <Input type="date" className="h-9 w-40" value={date} onChange={(e) => setDate(e.target.value)} />
      <Input type="time" className="h-9 w-28" value={start} onChange={(e) => setStart(e.target.value)} />
      <Input type="time" className="h-9 w-28" value={end} onChange={(e) => setEnd(e.target.value)} />
      <Button type="submit" className="h-9" disabled={schedule.isPending}>
        Agendar visita
      </Button>
    </form>
  );
}

export default function AgendaPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [technicianId, setTechnicianId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const { data: visits, isLoading } = useVisits({ date, technicianId: technicianId || undefined });
  const { data: agents } = useQuery({
    queryKey: ['users', 'INTERNAL'],
    queryFn: () => api<PublicUser[]>('/users?type=INTERNAL'),
  });

  const byTechnician = new Map<string, Visit[]>();
  for (const v of visits ?? []) {
    const list = byTechnician.get(v.technician.id) ?? [];
    list.push(v);
    byTechnician.set(v.technician.id, list);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Agenda</h1>
        <Button variant="outline" className="h-9" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Fechar' : 'Agendar visita'}
        </Button>
      </div>

      {showForm && <ScheduleForm onDone={() => setShowForm(false)} />}

      <div className="flex gap-2">
        <Input type="date" className="h-9 w-40" value={date} onChange={(e) => setDate(e.target.value)} />
        <Select className="h-9 w-48" value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
          <option value="">Todos os técnicos</option>
          {agents?.filter((a) => a.role === 'AGENT').map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {!isLoading && (visits?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma visita nessa data.</p>
      )}

      {Array.from(byTechnician.entries()).map(([techId, list]) => (
        <section key={techId} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">{list[0].technician.name}</h2>
          <ul className="flex flex-col gap-1">
            {list.map((v) => (
              <VisitRow key={v.id} visit={v} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function VisitRow({ visit }: { visit: Visit }) {
  const reschedule = useRescheduleVisit(visit.id);
  const cancel = useCancelVisit(visit.id);
  const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return (
    <li className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm">
      <span className="whitespace-nowrap font-mono text-xs">
        {time(visit.scheduledStart)}–{time(visit.scheduledEnd)}
      </span>
      <a href={`/app/chamados/${visit.ticket.id}`} className="text-primary hover:underline">
        #{visit.ticket.number}
      </a>
      <span className="text-muted-foreground">{visit.ticket.client?.name}</span>
      <Badge tone={statusTone(visit.status)}>{VISIT_STATUS_LABELS[visit.status]}</Badge>
      {visit.status === 'SCHEDULED' && (
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => {
              const novaData = prompt('Novo horário de início (YYYY-MM-DDTHH:mm)?', visit.scheduledStart.slice(0, 16));
              if (!novaData) return;
              reschedule.mutate(
                { scheduledStart: new Date(novaData).toISOString() },
                { onSuccess: () => toast.success('Visita reagendada.'), onError: onErr },
              );
            }}
          >
            Reagendar
          </button>
          <button
            type="button"
            className="text-destructive-foreground hover:underline"
            onClick={() =>
              cancel.mutate(undefined, { onSuccess: () => toast.success('Visita cancelada.'), onError: onErr })
            }
          >
            Cancelar
          </button>
        </div>
      )}
    </li>
  );
}
