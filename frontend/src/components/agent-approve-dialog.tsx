'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import type { Paged } from '@/lib/tickets';
import type { AssetType } from '@/lib/assets';
import { useApproveDevice, useLinkDevice, type AgentDevice } from '@/lib/agent';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const errToast = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');

export function AgentApproveDialog({ device, onClose }: { device: AgentDevice | null; onClose: () => void }) {
  const [locationId, setLocationId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [label, setLabel] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const approve = useApproveDevice();
  const link = useLinkDevice();
  const clientId = device?.clientId ?? '';

  const { data: locations } = useQuery({
    queryKey: ['locations', 'options', clientId],
    queryFn: () =>
      api<Paged<{ id: string; name: string }>>(`/locations?pageSize=100&clientId=${encodeURIComponent(clientId)}`),
    enabled: !!clientId,
  });
  const { data: types } = useQuery({
    queryKey: ['asset-types'],
    queryFn: () => api<AssetType[]>('/asset-types'),
  });
  const activeTypes = (types ?? []).filter((t) => t.active);

  // Reinicia o formulário a cada dispositivo aberto.
  useEffect(() => {
    setLocationId('');
    setLabel(device?.hostname ?? '');
    setAssignedTo('');
    setDescription('');
    setNotes('');
  }, [device?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pré-seleciona "Computador" (sem diferenciar maiúsculas) quando os tipos chegam.
  useEffect(() => {
    setTypeId(activeTypes.find((t) => t.name.toLowerCase() === 'computador')?.id ?? '');
  }, [device?.id, types]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!device) return null;
  const suggested = device.suggestedAsset;

  return (
    <Dialog open onClose={onClose} title={`Aprovar ${device.hostname}`}>
      {suggested && (
        <div className="mb-3 flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <Button
            type="button"
            disabled={link.isPending}
            onClick={() =>
              link.mutate(
                { id: device.id, assetId: suggested.id },
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
            Já existe o ativo {suggested.label} com este serial — vincular
          </Button>
        </div>
      )}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!locationId || !typeId || !label.trim()) return;
          approve.mutate(
            {
              id: device.id,
              locationId,
              typeId,
              label: label.trim(),
              assignedTo: assignedTo.trim() || undefined,
              description: description.trim() || undefined,
              notes: notes.trim() || undefined,
            },
            {
              onSuccess: () => {
                toast.success('Ativo criado.');
                onClose();
              },
              onError: errToast,
            },
          );
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ap-location">Local</Label>
          <Select id="ap-location" required value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Selecione…</option>
            {locations?.data.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ap-type">Tipo</Label>
          <Select id="ap-type" required value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">Selecione…</option>
            {activeTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ap-label">Nome</Label>
          <Input id="ap-label" required value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ap-assigned">Responsável</Label>
          <Input id="ap-assigned" maxLength={200} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ap-description">Descrição</Label>
          <Input
            id="ap-description"
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ap-notes">Observação</Label>
          <Textarea id="ap-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={approve.isPending}>
            Aprovar e criar ativo
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
