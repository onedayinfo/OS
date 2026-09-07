'use client';

import { useRouter } from 'next/navigation';
import { TicketTable } from '@/components/ticket-table';
import { Button } from '@/components/ui/button';

export default function AppQueuePage() {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Fila de chamados</h1>
        <Button onClick={() => router.push('/app/chamados/novo')}>Novo chamado</Button>
      </div>
      <TicketTable />
    </div>
  );
}
