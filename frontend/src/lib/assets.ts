export type AssetStatus = 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  ACTIVE: 'Ativo',
  MAINTENANCE: 'Em manutenção',
  INACTIVE: 'Inativo',
};

export interface AssetType {
  id: string;
  name: string;
  active: boolean;
}

export interface Asset {
  id: string;
  label: string;
  status: AssetStatus;
  serialNumber: string | null;
  brand: string | null;
  model: string | null;
  ip: string | null;
  mac: string | null;
  installedAt: string | null;
  warrantyEndsAt: string | null;
  notes: string | null;
  hasCredentials: boolean;
  client?: { id: string; name: string };
  location?: { id: string; name: string };
  type?: { id: string; name: string };
}

export interface AssetDetail extends Asset {
  clientId: string;
  locationId: string;
  typeId: string;
  recentTickets: {
    id: string;
    number: string;
    title: string;
    status: string;
    createdAt: string;
    assignee: { id: string; name: string } | null;
  }[];
}
