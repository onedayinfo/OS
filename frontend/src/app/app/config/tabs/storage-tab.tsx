'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

type SettingsView = Record<string, string | boolean>;
const errToast = (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');

const S3_FIELDS = [
  ['storage.s3.endpoint', 'Endpoint (R2/MinIO — deixe vazio p/ AWS)'],
  ['storage.s3.region', 'Região'],
  ['storage.s3.bucket', 'Bucket'],
  ['storage.s3.prefix', 'Prefixo (opcional)'],
] as const;

export default function StorageTab() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsView>('/settings') });
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!data) return;
    setF({
      'storage.driver': (data['storage.driver'] as string) || 'disk',
      'storage.s3.endpoint': (data['storage.s3.endpoint'] as string) ?? '',
      'storage.s3.region': (data['storage.s3.region'] as string) ?? '',
      'storage.s3.bucket': (data['storage.s3.bucket'] as string) ?? '',
      'storage.s3.prefix': (data['storage.s3.prefix'] as string) ?? '',
      'storage.s3.forcePathStyle': (data['storage.s3.forcePathStyle'] as string) || 'false',
      accessKeyId: '',
      secretAccessKey: '',
    });
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api('/settings', {
        method: 'PUT',
        body: {
          values: {
            'storage.driver': f['storage.driver'],
            ...Object.fromEntries(S3_FIELDS.map(([k]) => [k, f[k] ?? ''])),
            'storage.s3.forcePathStyle': f['storage.s3.forcePathStyle'],
            ...(f.accessKeyId ? { 'storage.s3.accessKeyId': f.accessKeyId } : {}),
            ...(f.secretAccessKey ? { 'storage.s3.secretAccessKey': f.secretAccessKey } : {}),
          },
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      setF((s) => ({ ...s, accessKeyId: '', secretAccessKey: '' }));
      toast.success('Configurações de armazenamento salvas.');
    },
    onError: errToast,
  });

  const test = useMutation({
    mutationFn: () => api('/settings/storage/test', { method: 'POST' }),
    onSuccess: () => toast.success('Conexão com o armazenamento OK.'),
    onError: errToast,
  });

  const isS3 = f['storage.driver'] === 's3';
  return (
    <div className="flex max-w-lg flex-col gap-4 pt-4">
      <div className="flex flex-col gap-1">
        <Label>Onde guardar os anexos</Label>
        <Select
          value={f['storage.driver'] ?? 'disk'}
          onChange={(e) => setF((s) => ({ ...s, 'storage.driver': e.target.value }))}
        >
          <option value="disk">Disco local do servidor</option>
          <option value="s3">Bucket S3 (AWS, Cloudflare R2, MinIO)</option>
        </Select>
      </div>
      {isS3 && (
        <>
          {S3_FIELDS.map(([k, label]) => (
            <div key={k} className="flex flex-col gap-1">
              <Label>{label}</Label>
              <Input
                value={f[k] ?? ''}
                onChange={(e) => setF((s) => ({ ...s, [k]: e.target.value }))}
              />
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <Label>Access Key ID</Label>
            <Input
              type="password"
              placeholder={data?.['storage.s3.accessKeyIdSet'] ? '•••••••• (configurada)' : ''}
              value={f.accessKeyId ?? ''}
              onChange={(e) => setF((s) => ({ ...s, accessKeyId: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Secret Access Key</Label>
            <Input
              type="password"
              placeholder={data?.['storage.s3.secretAccessKeySet'] ? '•••••••• (configurada)' : ''}
              value={f.secretAccessKey ?? ''}
              onChange={(e) => setF((s) => ({ ...s, secretAccessKey: e.target.value }))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f['storage.s3.forcePathStyle'] === 'true'}
              onChange={(e) =>
                setF((s) => ({
                  ...s,
                  'storage.s3.forcePathStyle': e.target.checked ? 'true' : 'false',
                }))
              }
            />
            Forçar path-style (MinIO / alguns provedores)
          </label>
        </>
      )}
      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          Salvar
        </Button>
        {isS3 && (
          <Button variant="ghost" onClick={() => test.mutate()} disabled={test.isPending}>
            Testar conexão
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Anexos já enviados continuam sendo lidos de onde foram gravados. Só os novos vão para o
        destino atual.
      </p>
    </div>
  );
}
