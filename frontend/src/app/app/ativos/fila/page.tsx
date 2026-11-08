'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import type { Paged } from '@/lib/tickets';
import type { Asset } from '@/lib/assets';
import {
  useAgentDevices,
  useIgnoreDevice,
  useLinkDevice,
  useRestoreDevice,
  type AgentDevice,
  type AgentDeviceStatus,
} from '@/lib/agent';
import { AgentApproveDialog } from '@/components/agent-approve-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';

const errToast = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');

function LinkDialog({ device, onClose }: { device: AgentDevice; onClose: () => void }) {
  const [assetId, setAssetId] = useState('');
  const link = useLinkDevice();
  const { data } = useQuery({
    queryKey: ['assets', 'options', device.clientId],
    queryFn: () => api<Paged<Asset>>(`/assets?clientId=${encodeURIComponent(device.clientId)}&pageSize=100`),
  });
  return (
    <Dialog open onClose={onClose} title={`Vincular ${device.hostname} a um ativo`}>
      <div className="flex flex-col gap-3">
        <Select aria-label="Ativo existente" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
          <option value="">Selecione o ativo…</option>
          {data?.data.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
              {a.serialNumber ? ` (${a.serialNumber})` : ''}
            </option>
          ))}
        </Select>
        <div className="flex gap-2">
          <Button
            disabled={!assetId || link.isPending}
            onClick={() =>
              link.mutate(
                { id: device.id, assetId },
                {
                  onSuccess: () => {
                    toast.success('Dispositivo vinculado.');
                    onClose();
                  },
                  onError: errToast,
                },
              )
            }
          >
            Vincular
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function Fila() {
  const clientId = useSearchParams().get('clientId') ?? undefined;
  const [tab, setTab] = useState<AgentDeviceStatus>('PENDING');
  const [approving, setApproving] = useState<AgentDevice | null>(null);
  const [linking, setLinking] = useState<AgentDevice | null>(null);
  const { data, isLoading } = useAgentDevices(tab, clientId);
  const ignore = useIgnoreDevice();
  const restore = useRestoreDevice();

  const act = (m: typeof ignore, id: string, msg: string) =>
    m.mutate(id, { onSuccess: () => toast.success(msg), onError: errToast });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Fila de cadastro</h1>
        <Link href="/app/ativos" className="text-sm text-primary hover:underline">
          Voltar aos ativos
        </Link>
      </div>
      {clientId && (
        <p className="text-sm text-muted-foreground">
          Filtrando por um cliente.{' '}
          <Link href="/app/ativos/fila" className="text-primary hover:underline">
            Ver todos
          </Link>
        </p>
      )}

      <div className="flex gap-2">
        <Button variant={tab === 'PENDING' ? 'default' : 'outline'} onClick={() => setTab('PENDING')}>
          Aguardando cadastro
        </Button>
        <Button variant={tab === 'IGNORED' ? 'default' : 'outline'} onClick={() => setTab('IGNORED')}>
          Ignorados
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Hostname</th>
              <th className="px-3 py-2 font-medium">Cliente</th>
              <th className="px-3 py-2 font-medium">Nº série</th>
              <th className="px-3 py-2 font-medium">Fabricante / modelo</th>
              <th className="px-3 py-2 font-medium">IP</th>
              <th className="px-3 py-2 font-medium">Último contato</th>
              <th className="px-3 py-2 font-medium">Versão</th>
              <th className="px-3 py-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            )}
            {data?.data.map((d) => (
              <tr key={d.id} className="border-t border-border">
                <td className="px-3 py-2">
                  {d.hostname}{' '}
                  {d.cloneSuspect && <Badge tone="amber">Possível clone</Badge>}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{d.client.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{d.serialNumber ?? '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {[d.manufacturer, d.model].filter(Boolean).join(' ') || '—'}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{d.ip ?? '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString('pt-BR') : '—'}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{d.agentVersion ?? '—'}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    {tab === 'PENDING' ? (
                      <>
                        <Button onClick={() => setApproving(d)}>Aprovar</Button>
                        <Button variant="outline" onClick={() => setLinking(d)}>
                          Vincular a existente
                        </Button>
                        <Button variant="outline" onClick={() => act(ignore, d.id, 'Dispositivo ignorado.')}>
                          Ignorar
                        </Button>
                      </>
                    ) : (
                      <Button variant="outline" onClick={() => act(restore, d.id, 'Dispositivo restaurado.')}>
                        Restaurar
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {data && data.data.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  {tab === 'PENDING' ? 'Nenhum dispositivo aguardando cadastro.' : 'Nenhum dispositivo ignorado.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AgentApproveDialog device={approving} onClose={() => setApproving(null)} />
      {linking && <LinkDialog device={linking} onClose={() => setLinking(null)} />}
    </div>
  );
}

export default function FilaPage() {
  return (
    <Suspense fallback={null}>
      <Fila />
    </Suspense>
  );
}
