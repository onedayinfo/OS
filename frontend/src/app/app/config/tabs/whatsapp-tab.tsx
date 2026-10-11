'use client';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { pauseText, usd, useSetup, useWhatsappStatus } from '@/lib/whatsapp';
import { WhatsappConnectionCard } from '@/components/whatsapp-connection-card';
import { TriggerPhrasesPanel } from '@/components/trigger-phrases-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type SettingsView = Record<string, string | boolean>;
const errToast = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');

export default function WhatsappTab() {
  const qc = useQueryClient();
  const { data: status } = useWhatsappStatus();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsView>('/settings') });
  const { data: setup, isLoading: setupLoading } = useSetup();
  const showUrl = !setup?.config.urlFromEnv;
  const showKey = !setup?.config.apiKeyFromEnv;
  const [form, setForm] = useState({
    url: '', evoKey: '', aiKey: '', aiLimit: '', aiDaily: '', aiMonthly: '', retention: '',
  });

  const seeded = useRef(false);
  useEffect(() => {
    if (!data || seeded.current) return;
    seeded.current = true;
    setForm((f) => ({
        ...f,
        url: (data['whatsapp.evolution.url'] as string) ?? '',
        aiLimit: (data['ai.dailyTokenLimit'] as string) ?? '',
        aiDaily: (data['ai.dailyCostLimitUsd'] as string) ?? '',
        aiMonthly: (data['ai.monthlyCostLimitUsd'] as string) ?? '',
        retention: (data['whatsapp.retentionDays'] as string) ?? '',
      }));
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api('/settings', {
        method: 'PUT',
        body: {
          values: {
            'ai.dailyTokenLimit': form.aiLimit,
            'ai.dailyCostLimitUsd': form.aiDaily,
            'ai.monthlyCostLimitUsd': form.aiMonthly,
            'whatsapp.retentionDays': form.retention,
            ...(showUrl && form.url.trim() !== '' ? { 'whatsapp.evolution.url': form.url } : {}),
            ...(showKey && form.evoKey ? { 'whatsapp.evolution.apiKey': form.evoKey } : {}),
            ...(form.aiKey ? { 'ai.anthropicApiKey': form.aiKey } : {}),
          },
        },
      }),
    onSuccess: () => {
      seeded.current = false;
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['wa-status'] });
      setForm((f) => ({ ...f, evoKey: '', aiKey: '' }));
      toast.success('Configurações do WhatsApp salvas.');
    },
    onError: errToast,
  });

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const ai = status?.ai;

  return (
    <div className="flex flex-col gap-8 pt-4">
      <section className="flex max-w-lg flex-col gap-3">
        <WhatsappConnectionCard />
        {ai && (
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <p>
              IA hoje: {ai.day.tokens.toLocaleString('pt-BR')} / {ai.limits.dailyTokens.toLocaleString('pt-BR')} tokens ·{' '}
              {usd(ai.day.costUsd)} / {usd(ai.limits.dailyCostUsd)}
            </p>
            <p>
              IA no mês: {usd(ai.month.costUsd)} / {usd(ai.limits.monthlyCostUsd)}
            </p>
            {ai.warn && <b className="text-warning-foreground">Atenção: gasto acima de 80% de um dos tetos.</b>}
            {ai.paused && <b className="text-destructive">IA pausada {pauseText(ai.reason)} (teto atingido).</b>}
            {ai.lastError && (
              <b className="text-destructive">
                {' '}
                — A IA está com problema: {ai.lastError.message} (desde{' '}
                {new Date(ai.lastError.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}). As
                mensagens continuam na fila.
              </b>
            )}
          </div>
        )}
      </section>

      <section className="flex max-w-lg flex-col gap-4">
        <h2 className="text-[14px] font-semibold">Evolution API</h2>
        {setupLoading ? (
          <p className="text-sm text-muted-foreground">Verificando…</p>
        ) : !showUrl && !showKey ? (
          <p className="text-sm text-muted-foreground">Evolution configurada pelo ambiente da stack.</p>
        ) : (
          <>
            {showUrl ? (
              <div className="flex flex-col gap-1">
                <Label>URL interna</Label>
                <Input placeholder="http://evolution-api:8080" value={form.url} onChange={set('url')} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">URL configurada pelo ambiente da stack.</p>
            )}
            {showKey ? (
              <div className="flex flex-col gap-1">
                <Label>Chave da API da Evolution</Label>
                <Input type="password" placeholder={data?.['whatsapp.evolution.apiKeySet'] ? '•••••••• (configurada)' : ''} value={form.evoKey} onChange={set('evoKey')} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Chave configurada pelo ambiente da stack.</p>
            )}
          </>
        )}
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
          <Label>Teto diário em dólar (US$)</Label>
          <Input placeholder="2" value={form.aiDaily} onChange={set('aiDaily')} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Teto mensal em dólar (US$)</Label>
          <Input placeholder="20" value={form.aiMonthly} onChange={set('aiMonthly')} />
        </div>
        <p className="text-xs text-muted-foreground">
          Custo estimado pelo preço do Haiku (US$ 1/M tokens de entrada, US$ 5/M de saída). Ao atingir qualquer teto a
          triagem pausa; os gatilhos por frase continuam.
        </p>
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
