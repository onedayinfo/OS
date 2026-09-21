'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface DashboardOverview {
  period: { start: string; end: string };
  tickets: { open: number; overdue: number; recurring: number; standalone: number };
  avgResolutionHours: number | null;
  technicianProductivity: Array<{
    technicianId: string;
    name: string;
    ticketsResolved: number;
    hoursWorked: number;
  }>;
  contractsExceeded: Array<{
    contractId: string;
    name: string;
    clientName: string;
    unit: 'VISITS' | 'HOURS';
    used: number;
    franchiseAmount: number;
  }>;
  margin: {
    ticketsCount: number;
    totalRevenue: number;
    totalMaterialCost: number;
    totalMargin: number;
    avgMarginPerTicket: number | null;
  };
}

export function useDashboardOverview() {
  return useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => api<DashboardOverview>('/dashboard/overview'),
  });
}
