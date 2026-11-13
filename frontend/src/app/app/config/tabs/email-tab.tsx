'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type SettingsView = Record<string, string | boolean>;
const errToast = (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');

export default function EmailTab() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsView>('/settings') });
  const [form, setForm] = useState({ apiKey: '', from: '', inboundSecret: '' });
  useEffect(() => {
    if (data) setForm((f) => ({ ...f, from: (data['mail.from'] as string) ?? '' }));
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api('/settings', {
        method: 'PUT',
        body: {
          values: {
            'mail.from': form.from,
            ...(form.apiKey ? { 'resend.apiKey': form.apiKey } : {}),
            ...(form.inboundSecret ? { 'resend.inboundSecret': form.inboundSecret } : {}),
          },
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      setForm((f) => ({ ...f, apiKey: '', inboundSecret: '' }));
      toast.success('Configurações de e-mail salvas.');
    },
    onError: errToast,
  });

  const keySet = data?.['resend.apiKeySet'] === true;
  const secretSet = data?.['resend.inboundSecretSet'] === true;

  return (
    <div className="flex max-w-lg flex-col gap-4 pt-4">
      {data && data.encryptionKeySet === false && (
        <p className="rounded-md border border-warning bg-warning px-3 py-2 text-sm text-warning-foreground">
          Defina a variável <code>APP_ENCRYPTION_KEY</code> no servidor para poder salvar segredos.
        </p>
      )}
      <div className="flex flex-col gap-1">
        <Label>Chave da API do Resend</Label>
        <p className="text-xs text-muted-foreground">
          Para receber chamados por e-mail, a chave precisa de <b>Full access</b>.
        </p>
        <Input
          type="password"
          placeholder={keySet ? '•••••••• (configurada)' : 'rk_live_…'}
          value={form.apiKey}
          onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label>Remetente (From)</Label>
        <Input
          placeholder="suporte@suaempresa.com.br"
          value={form.from}
          onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label>Segredo de assinatura do webhook (recebimento por e-mail)</Label>
        <p className="text-xs text-muted-foreground">
          No Resend, crie um webhook com o evento <code>email.received</code> para{' '}
          <code className="break-all">
            {typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/resend/inbound
          </code>{' '}
          e cole aqui o <b>Signing secret</b> dele. Deixe vazio se não for receber e-mails.
        </p>
        <Input
          type="password"
          placeholder={secretSet ? '•••••••• (configurado)' : 'whsec_…'}
          value={form.inboundSecret}
          onChange={(e) => setForm((f) => ({ ...f, inboundSecret: e.target.value }))}
        />
      </div>
      <Button onClick={() => save.mutate()} disabled={save.isPending} className="self-start">
        Salvar
      </Button>
    </div>
  );
}
