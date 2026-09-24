'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError, getAccessToken } from '@/lib/api';
import type { Attachment } from '@/lib/tickets';
import { ASSET_STATUS_LABELS, type AssetDetail, type AssetStatus } from '@/lib/assets';
import { AssetForm, type AssetFormPayload } from '@/components/asset-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';

const STATUS_TONE: Record<AssetStatus, 'green' | 'amber' | 'neutral'> = {
  ACTIVE: 'green',
  MAINTENANCE: 'amber',
  INACTIVE: 'neutral',
};

function errToast(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
}

function fmtDate(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('pt-BR') : '—';
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase text-muted-foreground">{label}</span>
      <span className="text-sm">{value || '—'}</span>
    </div>
  );
}

// Miniatura de foto: o GET /attachments/:id exige Bearer, então busca o blob com
// o token e renderiza via object URL (mesmo esquema do downloadAttachment).
function Thumb({ id, alt }: { id: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    const base = process.env.NEXT_PUBLIC_API_URL ?? '';
    const token = getAccessToken();
    fetch(`${base}/attachments/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  return (
    <div className="aspect-square overflow-hidden rounded-md border border-border bg-muted">
      {src && <img src={src} alt={alt} className="h-full w-full object-cover" />}
    </div>
  );
}

export default function AssetDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const qc = useQueryClient();
  const [tab, setTab] = useState('dados');
  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState<{
    username: string | null;
    password: string | null;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: asset, isLoading } = useQuery({
    queryKey: ['asset', id],
    queryFn: () => api<AssetDetail>(`/assets/${id}`),
  });

  const { data: photos } = useQuery({
    queryKey: ['asset-attachments', id],
    queryFn: () => api<Attachment[]>(`/assets/${id}/attachments`),
  });

  const update = useMutation({
    mutationFn: (v: AssetFormPayload) =>
      api<AssetDetail>(`/assets/${id}`, { method: 'PATCH', body: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asset', id] });
      qc.invalidateQueries({ queryKey: ['assets'] });
      setEditing(false);
      toast.success('Ativo atualizado.');
    },
    onError: errToast,
  });

  const reveal = useMutation({
    mutationFn: () =>
      api<{ username: string | null; password: string | null }>(
        `/assets/${id}/credentials`,
      ),
    onSuccess: (v) => setRevealed(v),
    onError: errToast,
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api(`/assets/${id}/attachments`, { method: 'POST', body: fd });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asset-attachments', id] });
      if (fileRef.current) fileRef.current.value = '';
      toast.success('Foto enviada.');
    },
    onError: errToast,
  });

  if (isLoading || !asset)
    return <p className="text-sm text-muted-foreground">Carregando…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">{asset.label}</h1>
        <Badge tone={STATUS_TONE[asset.status]}>
          {ASSET_STATUS_LABELS[asset.status]}
        </Badge>
        {asset.client && (
          <Link
            href={`/app/clientes/${asset.client.id}`}
            className="text-sm text-primary hover:underline"
          >
            {asset.client.name}
          </Link>
        )}
        {asset.location && (
          <span className="text-sm text-muted-foreground">· {asset.location.name}</span>
        )}
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'dados', label: 'Dados' },
          { value: 'credenciais', label: 'Credenciais' },
          { value: 'fotos', label: 'Fotos' },
          { value: 'historico', label: 'Histórico' },
        ]}
      />

      {tab === 'dados' &&
        (editing ? (
          <div className="max-w-2xl pt-4">
            <AssetForm
              initial={{
                clientId: asset.clientId,
                locationId: asset.locationId,
                typeId: asset.typeId,
                label: asset.label,
                brand: asset.brand,
                model: asset.model,
                serialNumber: asset.serialNumber,
                ip: asset.ip,
                mac: asset.mac,
                status: asset.status,
                notes: asset.notes,
                installedAt: asset.installedAt,
                warrantyEndsAt: asset.warrantyEndsAt,
              }}
              submitLabel="Salvar alterações"
              busy={update.isPending}
              onSubmit={(v) => update.mutate(v)}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4 pt-4">
            <div className="grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Tipo" value={asset.type?.name} />
              <Field label="Cliente" value={asset.client?.name} />
              <Field label="Local" value={asset.location?.name} />
              <Field label="Marca" value={asset.brand} />
              <Field label="Modelo" value={asset.model} />
              <Field label="Nº de série" value={asset.serialNumber} />
              <Field label="IP" value={asset.ip} />
              <Field label="MAC" value={asset.mac} />
              <Field label="Instalado em" value={fmtDate(asset.installedAt)} />
              <Field label="Garantia até" value={fmtDate(asset.warrantyEndsAt)} />
              <Field
                label="Credenciais"
                value={asset.hasCredentials ? 'Cadastradas' : 'Não cadastradas'}
              />
            </div>
            {asset.notes && (
              <div className="max-w-2xl">
                <Field label="Observações" value={asset.notes} />
              </div>
            )}
            <div>
              <Button variant="outline" onClick={() => setEditing(true)}>
                Editar
              </Button>
            </div>
          </div>
        ))}

      {tab === 'credenciais' && (
        <div className="flex flex-col gap-3 pt-4">
          {!asset.hasCredentials && (
            <p className="text-sm text-muted-foreground">
              Nenhuma credencial cadastrada.
            </p>
          )}
          {asset.hasCredentials && !revealed && (
            <div>
              <Button
                variant="outline"
                disabled={reveal.isPending}
                onClick={() => reveal.mutate()}
              >
                Revelar
              </Button>
            </div>
          )}
          {revealed && (
            <div className="flex max-w-md flex-col gap-2 rounded-md border border-border p-3">
              <Field label="Usuário" value={revealed.username} />
              <Field label="Senha" value={revealed.password} />
              <div>
                <Button variant="outline" onClick={() => setRevealed(null)}>
                  Ocultar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'fotos' && (
        <div className="flex flex-col gap-3 pt-4">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
            }}
          />
          {photos && photos.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma foto.</p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {photos?.map((p) => (
              <Thumb key={p.id} id={p.id} alt={p.filename} />
            ))}
          </div>
        </div>
      )}

      {tab === 'historico' && (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Número</th>
                <th className="px-3 py-2 font-medium">Título</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Responsável</th>
                <th className="px-3 py-2 font-medium">Aberto em</th>
              </tr>
            </thead>
            <tbody>
              {asset.recentTickets.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Link
                      href={`/app/chamados/${t.id}`}
                      className="text-primary hover:underline"
                    >
                      {t.number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{t.title}</td>
                  <td className="px-3 py-2 text-muted-foreground">{t.status}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {t.assignee?.name ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {new Date(t.createdAt).toLocaleDateString('pt-BR')}
                  </td>
                </tr>
              ))}
              {asset.recentTickets.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                    Nenhum chamado vinculado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
