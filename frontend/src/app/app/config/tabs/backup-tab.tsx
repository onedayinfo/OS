'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError, getAccessToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type SettingsView = Record<string, string | boolean>;
const errToast = (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');

async function downloadExport() {
  const res = await fetch('/api/backup/export', {
    headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
    credentials: 'include',
  });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    res.headers.get('Content-Disposition')?.match(/filename="(.+?)"/)?.[1] ?? 'os-backup.json';
  a.click();
  URL.revokeObjectURL(url);
}

export default function BackupTab() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsView>('/settings') });
  const list = useQuery({
    queryKey: ['backup', 'list'],
    queryFn: () => api<{ name: string }[]>('/backup/list'),
  });
  const [enabled, setEnabled] = useState(false);
  const [retention, setRetention] = useState('30');
  const [confirm, setConfirm] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!data) return;
    setEnabled(data['backup.s3.enabled'] === 'true');
    setRetention((data['backup.retention'] as string) || '30');
  }, [data]);

  const saveCfg = useMutation({
    mutationFn: () =>
      api('/settings', {
        method: 'PUT',
        body: {
          values: { 'backup.s3.enabled': enabled ? 'true' : 'false', 'backup.retention': retention },
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Configuração de backup salva.');
    },
    onError: errToast,
  });

  const download = useMutation({ mutationFn: downloadExport, onError: errToast });

  const doImport = useMutation({
    mutationFn: async () => {
      const f = fileRef.current?.files?.[0];
      if (!f) throw new ApiError(400, { message: 'Escolha um arquivo .json.' });
      const body = new FormData();
      body.append('file', f);
      body.append('confirm', confirm);
      const res = await fetch('/api/backup/import', {
        method: 'POST',
        body,
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        credentials: 'include',
      });
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
    },
    onSuccess: () => {
      toast.success('Restauração concluída. Você pode precisar entrar de novo.');
      setConfirm('');
      if (fileRef.current) fileRef.current.value = '';
    },
    onError: errToast,
  });

  return (
    <div className="flex max-w-lg flex-col gap-6 pt-4">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Backup manual</h2>
        <Button
          onClick={() => download.mutate()}
          disabled={download.isPending}
          className="self-start"
        >
          Baixar backup agora (.json)
        </Button>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Backup automático</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Gravar um backup diário (03:00) no armazenamento configurado
        </label>
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label>Manter os últimos</Label>
            <Input
              type="number"
              min={1}
              className="w-24"
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
            />
          </div>
          <Button onClick={() => saveCfg.mutate()} disabled={saveCfg.isPending}>
            Salvar
          </Button>
        </div>
        <ul className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
          {list.data?.map((b) => <li key={b.name}>{b.name.replace('backups/', '')}</li>)}
          {list.data && list.data.length === 0 && <li>Nenhum backup automático ainda.</li>}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-red-600">
          Restaurar (apaga todos os dados atuais)
        </h2>
        <p className="text-xs text-muted-foreground">
          Substitui todo o conteúdo do sistema pelo do arquivo. Exige a mesma chave de criptografia
          (<code>APP_ENCRYPTION_KEY</code>) do servidor de origem para os segredos voltarem a
          funcionar.
        </p>
        <input ref={fileRef} type="file" accept="application/json,.json" className="text-sm" />
        <Input
          placeholder="Digite RESTAURAR para confirmar"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <Button
          variant="ghost"
          className="self-start text-red-600 hover:bg-red-50"
          disabled={confirm !== 'RESTAURAR' || doImport.isPending}
          onClick={() => doImport.mutate()}
        >
          Importar e restaurar
        </Button>
      </section>
    </div>
  );
}
