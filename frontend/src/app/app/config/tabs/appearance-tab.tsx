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

export default function AppearanceTab() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsView>('/settings') });
  const [name, setName] = useState('');
  const [color, setColor] = useState('#1d4ed8');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!data) return;
    setName((data['branding.companyName'] as string) ?? '');
    setColor((data['branding.primaryColor'] as string) || '#1d4ed8');
  }, [data]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['settings'] });
    qc.invalidateQueries({ queryKey: ['branding'] });
  };

  const save = useMutation({
    mutationFn: () =>
      api('/settings', {
        method: 'PUT',
        body: { values: { 'branding.companyName': name, 'branding.primaryColor': color } },
      }),
    onSuccess: () => {
      refresh();
      toast.success('Aparência salva.');
    },
    onError: errToast,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/settings/branding/logo', {
        method: 'POST',
        body,
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        credentials: 'include',
      });
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
    },
    onSuccess: () => {
      refresh();
      if (fileRef.current) fileRef.current.value = '';
      toast.success('Logo atualizado.');
    },
    onError: errToast,
  });

  const removeLogo = useMutation({
    mutationFn: () => api('/settings/branding/logo', { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      toast.success('Logo removido.');
    },
    onError: errToast,
  });

  const hasLogo = data?.['branding.logoDataSet'] === true;
  return (
    <div className="flex max-w-lg flex-col gap-4 pt-4">
      <div className="flex flex-col gap-1">
        <Label>Nome da empresa</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sua Empresa Ltda"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label>Cor primária</Label>
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#1d4ed8'}
          onChange={(e) => setColor(e.target.value)}
          className="h-9 w-16 rounded border border-border bg-transparent"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label>Logo</Label>
        {hasLogo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/api/branding/logo"
            alt="Logo atual"
            className="h-12 w-auto rounded border border-border p-1"
          />
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
          className="text-sm"
        />
        <p className="text-xs text-muted-foreground">PNG, JPEG, WebP ou SVG. Até 512 KB.</p>
        {hasLogo && (
          <button
            type="button"
            className="self-start text-sm text-primary hover:underline"
            onClick={() => removeLogo.mutate()}
          >
            Remover logo
          </button>
        )}
      </div>
      <Button onClick={() => save.mutate()} disabled={save.isPending} className="self-start">
        Salvar
      </Button>
    </div>
  );
}
