'use client';
import { useEffect, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useWhatsappStatus } from '@/lib/whatsapp';
import { TriggerPhrasesPanel } from '@/components/trigger-phrases-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type SettingsView = Record<string, string | boolean>;
const errToast = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');

const STATE_LABEL: Record<string, string> = {
  open: 'Conectado',
  close: 'Desconectado',
  connecting: 'Conectando…',
  unreachable: 'Evolution inalcançável',
  not_configured: 'Não configurado',
};

export default function WhatsappTab() {
  const qc = useQueryClient();
  const { data: status } = useWhatsappStatus();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsView>('/settings') });
  const [qr, setQr] = useState<{ base64: string | null; pairingCode: string | null } | null>(null);
  const [form, setForm] = useState({
    url: '', instance: '', evoKey: '', webhookSecret: '', aiKey: '', aiLimit: '', retention: '',
  });

  useEffect(() => {
    if (data)
      setForm((f) => ({
        ...f,
        url: (data['whatsapp.evolution.url'] as string) ?? '',
        instance: (data['whatsapp.evolution.instance'] as string) ?? '',
        aiLimit: (data['ai.dailyTokenLimit'] as string) ?? '',
        retention: (data['whatsapp.retentionDays'] as string) ?? '',
      }));
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api('/settings', {
        method: 'PUT',
        body: {
          values: {
            'whatsapp.evolution.url': form.url,
            'whatsapp.evolution.instance': form.instance,
            'ai.dailyTokenLimit': form.aiLimit,
            'whatsapp.retentionDays': form.retention,
            ...(form.evoKey ? { 'whatsapp.evolution.apiKey': form.evoKey } : {}),
            ...(form.webhookSecret ? { 'whatsapp.webhookSecret': form.webhookSecret } : {}),
            ...(form.aiKey ? { 'ai.anthropicApiKey': form.aiKey } : {}),
          },
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['wa-status'] });
      setForm((f) => ({ ...f, evoKey: '', webhookSecret: '', aiKey: '' }));
      toast.success('Configurações do WhatsApp salvas.');
    },
    onError: errToast,
  });

  const fetchQr = useMutation({
    mutationFn: () => api<{ base64: string | null; pairingCode: string | null }>('/whatsapp/qr'),
    onSuccess: (r) => (r.base64 || r.pairingCode ? setQr(r) : toast.error('Sem QR agora (já conectado ou Evolution indisponível).')),
    onError: errToast,
  });

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const conn = status?.connection;
  const ai = status?.ai;

  return (
    <div className="flex flex-col gap-8 pt-4">
      <section className="flex max-w-lg flex-col gap-3">
        <h2 className="text-[14px] font-semibold">Conexão</h2>
        <div className="flex items-center gap-2">
          <Badge tone={conn?.state === 'open' ? 'green' : 'red'}>{STATE_LABEL[conn?.state ?? ''] ?? conn?.state ?? '…'}</Badge>
          {conn?.disconnectedSince && (
            <span className="text-sm text-muted-foreground">
              desde {new Date(conn.disconnectedSince).toLocaleString('pt-BR')}
            </span>
          )}
        </div>
        <Button variant="outline" className="self-start" disabled={fetchQr.isPending} onClick={() => fetchQr.mutate()}>
          Gerar QR code de pareamento
        </Button>
        {qr?.base64?.startsWith('data:image/') && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr.base64} alt="QR code do WhatsApp" className="h-56 w-56 rounded border border-border bg-white p-2" />
        )}
        {qr?.pairingCode && <p className="text-sm">Código de pareamento: <b>{qr.pairingCode}</b></p>}
        {ai && (
          <p className="text-sm text-muted-foreground">
            IA hoje: {ai.usedToday.toLocaleString('pt-BR')} / {ai.limit.toLocaleString('pt-BR')} tokens
            {ai.paused && <b className="text-destructive"> — pausada até amanhã</b>}
          </p>
        )}
      </section>

      <section className="flex max-w-lg flex-col gap-4">
        <h2 className="text-[14px] font-semibold">Evolution API</h2>
        <div className="flex flex-col gap-1">
          <Label>URL interna</Label>
          <Input placeholder="http://evolution-api:8080" value={form.url} onChange={set('url')} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Nome da instância</Label>
          <Input placeholder="os" value={form.instance} onChange={set('instance')} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Chave da API da Evolution</Label>
          <Input type="password" placeholder={data?.['whatsapp.evolution.apiKeySet'] ? '•••••••• (configurada)' : ''} value={form.evoKey} onChange={set('evoKey')} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Segredo do webhook</Label>
          <Input type="password" placeholder={data?.['whatsapp.webhookSecretSet'] ? '•••••••• (configurado)' : ''} value={form.webhookSecret} onChange={set('webhookSecret')} />
          <p className="text-xs text-muted-foreground">Vai no header <code>x-webhook-secret</code> configurado no webhook da Evolution.</p>
        </div>
      </section>

      <section className="flex max-w-lg flex-col gap-4">
        <h2 className="text-[14px] font-semibold">Inteligência artificial</h2>
        <p className="text-xs text-muted-foreground">
          O texto das mensagens dos grupos é enviado à API da Anthropic para triagem. Avise os participantes dos grupos.
        </p>
        <div className="flex flex-col gap-1">
          <Label>Chave da API da Anthropic</Label>
          <Input type="password" placeholder={data?.['ai.anthropicApiKeySet'] ? '•••••••• (configurada)' : 'sk-ant-…'} value={form.aiKey} onChange={set('aiKey')} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Teto diário de tokens</Label>
          <Input placeholder="500000" value={form.aiLimit} onChange={set('aiLimit')} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Guardar mensagens por (dias)</Label>
          <Input placeholder="90" value={form.retention} onChange={set('retention')} />
        </div>
        <Button className="self-start" disabled={save.isPending} onClick={() => save.mutate()}>
          Salvar
        </Button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[14px] font-semibold">Frases de gatilho padrão</h2>
        <p className="text-sm text-muted-foreground">
          Copiadas para um cliente pelo botão "Aplicar frases padrão" na aba WhatsApp dele. Mudar aqui depois não altera os clientes já criados.
        </p>
        <TriggerPhrasesPanel clientId={null} />
      </section>
    </div>
  );
}
