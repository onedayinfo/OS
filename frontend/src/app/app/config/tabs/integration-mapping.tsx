'use client';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { PRIORITY_LABELS, type TicketPriority } from '@/lib/tickets';
import { flattenPaths, renderTemplate } from '@/lib/integration-template';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export interface Mapping {
  title: string;
  description?: string;
  externalId?: string;
  assetSerial?: string;
  priority?: TicketPriority;
}
interface IntegrationDetail {
  id: string;
  name: string;
  mapping: Mapping | null;
  lastPayload: unknown;
  lastPayloadAt: string | null;
}

type TextField = 'title' | 'description' | 'externalId' | 'assetSerial';
const FIELDS: { key: TextField; label: string; hint: string }[] = [
  { key: 'title', label: 'Título *', hint: 'Ex.: Câmera: {{alarm.name}}' },
  { key: 'description', label: 'Descrição', hint: 'Detalhes do evento, link…' },
  { key: 'externalId', label: 'ID externo (evita chamado repetido)', hint: 'Ex.: {{alarm.name}}' },
  { key: 'assetSerial', label: 'Nº de série do ativo', hint: 'Vincula o ativo do cliente' },
];
const PRIORITIES: TicketPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

const errToast = (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');

export default function IntegrationMapping({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, refetch, isFetching } = useQuery({
    queryKey: ['integrations', id],
    queryFn: () => api<IntegrationDetail>(`/integrations/${id}`),
  });
  // Estado do formulário só nasce quando o detalhe chega (key no pai força remontagem por integração).
  const [form, setForm] = useState<Mapping | null>(null);
  const m: Mapping = form ?? data?.mapping ?? { title: '', priority: 'MEDIUM' };
  const [focused, setFocused] = useState<TextField>('title');
  const refs = useRef<Partial<Record<TextField, HTMLInputElement | HTMLTextAreaElement | null>>>({});

  const paths = useMemo(() => flattenPaths(data?.lastPayload ?? null), [data?.lastPayload]);
  const set = (patch: Partial<Mapping>) => setForm({ ...m, ...patch });

  /** Insere `{{caminho}}` na posição do cursor do campo em foco. */
  function insert(path: string) {
    const el = refs.current[focused];
    const cur = m[focused] ?? '';
    const token = `{{${path}}}`;
    const start = el?.selectionStart ?? cur.length;
    const end = el?.selectionEnd ?? cur.length;
    set({ [focused]: cur.slice(0, start) + token + cur.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const save = useMutation({
    mutationFn: (mapping: Mapping | null) =>
      api(`/integrations/${id}`, { method: 'PATCH', body: { mapping } }),
    onSuccess: (_, mapping) => {
      qc.invalidateQueries({ queryKey: ['integrations'] });
      setForm(null);
      toast.success(mapping ? 'Mapeamento salvo.' : 'Mapeamento removido.');
      if (!mapping) onClose();
    },
    onError: errToast,
  });

  const payload = data?.lastPayload;
  const preview = {
    title: renderTemplate(m.title, payload),
    description: renderTemplate(m.description, payload),
    externalId: renderTemplate(m.externalId, payload),
    assetSerial: renderTemplate(m.assetSerial, payload),
  };

  function submit() {
    if (!m.title.trim()) return toast.error('Informe o modelo do título.');
    const clean: Mapping = { title: m.title.trim(), priority: m.priority ?? 'MEDIUM' };
    for (const k of ['description', 'externalId', 'assetSerial'] as const) {
      if (m[k]?.trim()) clean[k] = m[k]!.trim();
    }
    save.mutate(clean);
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Mapear campos — {data?.name}</span>
        <span className="text-xs text-muted-foreground">
          Último evento recebido:{' '}
          {data?.lastPayloadAt ? new Date(data.lastPayloadAt).toLocaleString('pt-BR') : 'nenhum'}
        </span>
        <Button
          variant="outline"
          className="ml-auto h-7 text-xs"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          Atualizar exemplo
        </Button>
        <Button variant="outline" className="h-7 text-xs" onClick={onClose}>
          Fechar
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Label>Campos do evento recebido</Label>
          {paths.length ? (
            <>
              <p className="text-xs text-muted-foreground">
                Clique num campo para inserir no campo do chamado em foco.
              </p>
              <ul className="max-h-80 overflow-auto rounded border border-border">
                {paths.map((p) => (
                  <li key={p.path}>
                    <button
                      type="button"
                      onClick={() => insert(p.path)}
                      className="flex w-full gap-2 px-2 py-1 text-left text-xs hover:bg-muted"
                    >
                      <code className="shrink-0 text-primary">{p.path}</code>
                      <span className="truncate text-muted-foreground">{p.value}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="rounded border border-dashed border-border p-3 text-xs text-muted-foreground">
              Nenhum evento recebido ainda. Configure o equipamento com a URL e o token desta
              integração, dispare um evento (de preferência real) e clique em “Atualizar exemplo”.
              Enquanto não houver mapeamento, os eventos só são guardados, sem abrir chamado.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {FIELDS.map((f) => {
            const common = {
              id: `map-${f.key}`,
              placeholder: f.hint,
              value: m[f.key] ?? '',
              onFocus: () => setFocused(f.key),
              onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                set({ [f.key]: e.target.value }),
              className: focused === f.key ? 'ring-2 ring-ring' : undefined,
            };
            return (
              <div key={f.key} className="flex flex-col gap-1">
                <Label htmlFor={common.id}>{f.label}</Label>
                {f.key === 'description' ? (
                  <Textarea rows={3} ref={(el) => { refs.current[f.key] = el; }} {...common} />
                ) : (
                  <Input ref={(el) => { refs.current[f.key] = el; }} {...common} />
                )}
              </div>
            );
          })}
          <div className="flex flex-col gap-1">
            <Label htmlFor="map-priority">Prioridade</Label>
            <Select
              id="map-priority"
              value={m.priority ?? 'MEDIUM'}
              onChange={(e) => set({ priority: e.target.value as TicketPriority })}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      {payload != null && (
        <div className="rounded border border-border bg-muted/40 p-2 text-xs">
          <p className="mb-1 font-medium">Pré-visualização com o último evento</p>
          <p>
            <b>Título:</b>{' '}
            {preview.title || <span className="text-destructive">(vazio — o evento seria recusado)</span>}
          </p>
          {preview.description && (
            <p className="whitespace-pre-wrap">
              <b>Descrição:</b> {preview.description}
            </p>
          )}
          <p>
            <b>Prioridade:</b> {PRIORITY_LABELS[m.priority ?? 'MEDIUM']}
            {preview.externalId && <> · <b>ID externo:</b> {preview.externalId}</>}
            {preview.assetSerial && <> · <b>Nº de série:</b> {preview.assetSerial}</>}
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <Button onClick={submit} disabled={save.isPending}>
          Salvar mapeamento
        </Button>
        {data?.mapping && (
          <Button
            variant="outline"
            onClick={() => {
              if (confirm('Remover o mapeamento? Eventos voltam a ser só guardados (ou aceitos no formato padrão).'))
                save.mutate(null);
            }}
          >
            Remover mapeamento
          </Button>
        )}
      </div>
    </div>
  );
}
