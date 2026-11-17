'use client';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { PRIORITY_LABELS, type TicketPriority } from '@/lib/tickets';
import { classifyStatus, flattenPaths, renderTemplate } from '@/lib/integration-template';
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
  status?: string;
  problemValues?: string[];
  okValues?: string[];
  okAction?: 'RESOLVED' | 'CLOSED';
}
interface IntegrationDetail {
  id: string;
  name: string;
  mapping: Mapping | null;
  lastPayload: unknown;
  lastPayloadAt: string | null;
  recentPayloads: { at: string; payload: unknown }[] | null;
}

type TextField = 'title' | 'description' | 'externalId' | 'assetSerial' | 'status';
const FIELDS: { key: Exclude<TextField, 'status'>; label: string; hint: string }[] = [
  { key: 'title', label: 'Título *', hint: 'Ex.: Câmera: {{alarm.name}}' },
  { key: 'description', label: 'Descrição', hint: 'Detalhes do evento, link…' },
  { key: 'externalId', label: 'ID externo (identifica o equipamento / evita chamado repetido)', hint: 'Ex.: {{alarm.triggers.0.device}}' },
  { key: 'assetSerial', label: 'Nº de série do ativo', hint: 'Vincula o ativo do cliente' },
];
const PRIORITIES: TicketPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

const splitValues = (s: string) =>
  s
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

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
  // Listas de valores digitadas como texto livre (vírgula); viram lista ao salvar.
  const [problemText, setProblemText] = useState<string | null>(null);
  const [okText, setOkText] = useState<string | null>(null);
  const problemStr = problemText ?? (m.problemValues ?? []).join(', ');
  const okStr = okText ?? (m.okValues ?? []).join(', ');

  // Últimos eventos recebidos (antes da 0.22.0 só havia o último).
  const recent = data?.recentPayloads?.length
    ? data.recentPayloads
    : data?.lastPayloadAt
      ? [{ at: data.lastPayloadAt, payload: data.lastPayload }]
      : [];
  const [exampleIdx, setExampleIdx] = useState(0);
  const idx = Math.min(exampleIdx, Math.max(recent.length - 1, 0));
  const payload = recent[idx]?.payload;
  const paths = useMemo(() => flattenPaths(payload ?? null), [payload]);
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
      setProblemText(null);
      setOkText(null);
      toast.success(mapping ? 'Mapeamento salvo.' : 'Mapeamento removido.');
      if (!mapping) onClose();
    },
    onError: errToast,
  });

  const status = classifyStatus(
    { ...m, problemValues: splitValues(problemStr), okValues: splitValues(okStr) },
    payload,
  );
  /** Valores do campo de status vistos nos eventos recentes (ajuda a preencher as listas). */
  const seenStatus = m.status?.trim()
    ? Array.from(new Set(recent.map((e) => renderTemplate(m.status, e.payload)).filter(Boolean)))
    : [];
  const preview = {
    title: renderTemplate(m.title, payload),
    description: renderTemplate(m.description, payload),
    externalId: renderTemplate(m.externalId, payload),
    assetSerial: renderTemplate(m.assetSerial, payload),
  };
  const okLabel = (m.okAction ?? 'RESOLVED') === 'CLOSED' ? 'Fechado' : 'Resolvido';

  function submit() {
    if (!m.title.trim()) return toast.error('Informe o modelo do título.');
    const clean: Mapping = { title: m.title.trim(), priority: m.priority ?? 'MEDIUM' };
    for (const k of ['description', 'externalId', 'assetSerial'] as const) {
      if (m[k]?.trim()) clean[k] = m[k]!.trim();
    }
    if (m.status?.trim()) {
      if (!clean.externalId) {
        return toast.error('Com regra de status, preencha o ID externo (identifica o equipamento).');
      }
      clean.status = m.status.trim();
      clean.problemValues = splitValues(problemStr);
      clean.okValues = splitValues(okStr);
      clean.okAction = m.okAction ?? 'RESOLVED';
    }
    save.mutate(clean);
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Mapear campos — {data?.name}</span>
        <Label htmlFor="map-example" className="text-xs text-muted-foreground">
          Exemplo:
        </Label>
        {recent.length ? (
          <Select
            id="map-example"
            className="h-7 w-auto text-xs"
            value={String(idx)}
            onChange={(e) => setExampleIdx(Number(e.target.value))}
          >
            {recent.map((e, i) => (
              <option key={`${e.at}-${i}`} value={i}>
                {new Date(e.at).toLocaleString('pt-BR')}
                {m.status?.trim()
                  ? ` — ${renderTemplate(m.status, e.payload) || '(sem status)'}`
                  : ''}
              </option>
            ))}
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">nenhum evento recebido</span>
        )}
        <Button
          variant="outline"
          className="ml-auto h-7 text-xs"
          onClick={() => {
            setExampleIdx(0);
            refetch();
          }}
          disabled={isFetching}
        >
          Atualizar exemplos
        </Button>
        <Button variant="outline" className="h-7 text-xs" onClick={onClose}>
          Fechar
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Label>Campos do evento selecionado</Label>
          {paths.length ? (
            <>
              <p className="text-xs text-muted-foreground">
                Clique num campo para inserir no campo do chamado em foco.
              </p>
              <ul className="max-h-96 overflow-auto rounded border border-border">
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
              integração, dispare um evento (de preferência real) e clique em “Atualizar exemplos”.
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

          <fieldset className="flex flex-col gap-2 rounded border border-border p-2">
            <legend className="px-1 text-xs font-medium">Status do equipamento (opcional)</legend>
            <p className="text-xs text-muted-foreground">
              Abre chamado quando o equipamento cai e encerra sozinho quando ele volta. O
              <b> ID externo</b> precisa ser o mesmo nos dois eventos (ex.: o identificador do
              equipamento).
            </p>
            <div className="flex flex-col gap-1">
              <Label htmlFor="map-status">Campo de status</Label>
              <Input
                id="map-status"
                placeholder="Ex.: {{alarm.triggers.0.key}}"
                value={m.status ?? ''}
                ref={(el) => {
                  refs.current.status = el;
                }}
                onFocus={() => setFocused('status')}
                onChange={(e) => set({ status: e.target.value })}
                className={focused === 'status' ? 'ring-2 ring-ring' : undefined}
              />
              {seenStatus.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Valores vistos nos últimos eventos:{' '}
                  {seenStatus.map((v) => (
                    <code key={v} className="mr-1 rounded bg-muted px-1">
                      {v}
                    </code>
                  ))}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="map-problem">Valores que abrem chamado (separe por vírgula)</Label>
              <Input
                id="map-problem"
                placeholder="Ex.: disconnected, offline — vazio = qualquer outro valor"
                value={problemStr}
                onChange={(e) => setProblemText(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="map-ok">Valores que encerram o chamado</Label>
              <Input
                id="map-ok"
                placeholder="Ex.: connected, online"
                value={okStr}
                onChange={(e) => setOkText(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="map-okaction">Ao normalizar</Label>
              <Select
                id="map-okaction"
                value={m.okAction ?? 'RESOLVED'}
                onChange={(e) => set({ okAction: e.target.value as 'RESOLVED' | 'CLOSED' })}
              >
                <option value="RESOLVED">Marcar como Resolvido</option>
                <option value="CLOSED">Fechar (dispara a pesquisa de satisfação, se ativa)</option>
              </Select>
            </div>
          </fieldset>
        </div>
      </div>

      {payload != null && (
        <div className="rounded border border-border bg-muted/40 p-2 text-xs">
          <p className="mb-1 font-medium">Pré-visualização com o evento selecionado</p>
          {status && (
            <p>
              <b>Status:</b> <code>{status.value || '(vazio)'}</code> →{' '}
              {status.kind === 'problem'
                ? 'abre chamado (ou registra no chamado aberto deste equipamento)'
                : status.kind === 'ok'
                  ? `encerra o chamado aberto deste equipamento (${okLabel})`
                  : 'ignorado (não abre nem encerra)'}
            </p>
          )}
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
