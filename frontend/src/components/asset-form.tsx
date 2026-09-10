'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Paged } from '@/lib/tickets';
import {
  ASSET_STATUS_LABELS,
  type AssetStatus,
  type AssetType,
} from '@/lib/assets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export interface AssetFormPayload {
  clientId: string;
  locationId: string;
  typeId: string;
  label: string;
  brand: string;
  model: string;
  serialNumber: string;
  ip: string;
  mac: string;
  status: AssetStatus;
  notes: string;
  installedAt?: string;
  warrantyEndsAt?: string;
  credentials?: { username: string; password: string };
}

export interface AssetInitial {
  clientId?: string;
  locationId?: string;
  typeId?: string;
  label?: string;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  ip?: string | null;
  mac?: string | null;
  status?: AssetStatus;
  notes?: string | null;
  installedAt?: string | null;
  warrantyEndsAt?: string | null;
}

interface Client {
  id: string;
  name: string;
}
interface LocationRow {
  id: string;
  name: string;
}

// 'YYYY-MM-DD' para <input type="date">; aceita ISO completo vindo do backend.
function toDateInput(v: string | null | undefined): string {
  return v ? v.slice(0, 10) : '';
}

export function AssetForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: AssetInitial;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (v: AssetFormPayload) => void;
  onCancel?: () => void;
}) {
  const editing = !!initial;

  const [clientId, setClientId] = useState(initial?.clientId ?? '');
  const [locationId, setLocationId] = useState(initial?.locationId ?? '');
  const [typeId, setTypeId] = useState(initial?.typeId ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [brand, setBrand] = useState(initial?.brand ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [serialNumber, setSerialNumber] = useState(initial?.serialNumber ?? '');
  const [ip, setIp] = useState(initial?.ip ?? '');
  const [mac, setMac] = useState(initial?.mac ?? '');
  const [installedAt, setInstalledAt] = useState(toDateInput(initial?.installedAt));
  const [warrantyEndsAt, setWarrantyEndsAt] = useState(
    toDateInput(initial?.warrantyEndsAt),
  );
  const [status, setStatus] = useState<AssetStatus>(initial?.status ?? 'ACTIVE');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [credUser, setCredUser] = useState('');
  const [credPass, setCredPass] = useState('');

  const { data: clients } = useQuery({
    queryKey: ['clients', 'options'],
    queryFn: () => api<Paged<Client>>('/clients?pageSize=100'),
  });

  const { data: locations } = useQuery({
    queryKey: ['locations', 'options', clientId],
    queryFn: () =>
      api<Paged<LocationRow>>(
        `/locations?pageSize=100&clientId=${encodeURIComponent(clientId)}`,
      ),
    enabled: !!clientId,
  });

  const { data: types } = useQuery({
    queryKey: ['asset-types'],
    queryFn: () => api<AssetType[]>('/asset-types'),
  });
  const activeTypes = (types ?? []).filter(
    (t) => t.active || t.id === initial?.typeId,
  );

  // Trocar de cliente invalida o local escolhido (a menos que seja o inicial).
  useEffect(() => {
    if (clientId !== initial?.clientId) setLocationId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!clientId || !locationId || !typeId || !label.trim()) return;
        const payload: AssetFormPayload = {
          clientId,
          locationId,
          typeId,
          label: label.trim(),
          brand: brand.trim(),
          model: model.trim(),
          serialNumber: serialNumber.trim(),
          ip: ip.trim(),
          mac: mac.trim(),
          status,
          notes: notes.trim(),
        };
        if (installedAt) payload.installedAt = installedAt;
        if (warrantyEndsAt) payload.warrantyEndsAt = warrantyEndsAt;
        if (credUser || credPass) {
          payload.credentials = { username: credUser, password: credPass };
        }
        onSubmit(payload);
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="a-client">Cliente</Label>
        <Select
          id="a-client"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        >
          <option value="">Selecione…</option>
          {clients?.data.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="a-location">Local</Label>
        <Select
          id="a-location"
          value={locationId}
          disabled={!clientId}
          onChange={(e) => setLocationId(e.target.value)}
        >
          <option value="">{clientId ? 'Selecione…' : 'Escolha o cliente primeiro'}</option>
          {locations?.data.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="a-type">Tipo</Label>
        <Select id="a-type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          <option value="">Selecione…</option>
          {activeTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="a-label">Identificação</Label>
        <Input id="a-label" value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="a-brand">Marca</Label>
          <Input id="a-brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="a-model">Modelo</Label>
          <Input id="a-model" value={model} onChange={(e) => setModel(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="a-serial">Nº de série</Label>
          <Input
            id="a-serial"
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="a-ip">IP</Label>
          <Input id="a-ip" value={ip} onChange={(e) => setIp(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="a-mac">MAC</Label>
          <Input id="a-mac" value={mac} onChange={(e) => setMac(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="a-status">Status</Label>
          <Select
            id="a-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as AssetStatus)}
          >
            {(Object.keys(ASSET_STATUS_LABELS) as AssetStatus[]).map((s) => (
              <option key={s} value={s}>
                {ASSET_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="a-installed">Instalado em</Label>
          <Input
            id="a-installed"
            type="date"
            value={installedAt}
            onChange={(e) => setInstalledAt(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="a-warranty">Garantia até</Label>
          <Input
            id="a-warranty"
            type="date"
            value={warrantyEndsAt}
            onChange={(e) => setWarrantyEndsAt(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="a-notes">Observações</Label>
        <Textarea id="a-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">Credenciais</legend>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="a-cred-user">Usuário</Label>
            <Input
              id="a-cred-user"
              autoComplete="off"
              value={credUser}
              onChange={(e) => setCredUser(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="a-cred-pass">Senha</Label>
            <Input
              id="a-cred-pass"
              type="password"
              autoComplete="new-password"
              value={credPass}
              onChange={(e) => setCredPass(e.target.value)}
            />
          </div>
        </div>
        {editing && (
          <p className="text-xs text-muted-foreground">
            Deixe em branco para manter as credenciais atuais.
          </p>
        )}
      </fieldset>

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
