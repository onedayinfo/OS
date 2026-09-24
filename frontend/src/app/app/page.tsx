'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TicketTable } from '@/components/ticket-table';
import { NewTicketForm } from '@/components/new-ticket-form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

export default function AppQueuePage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Fila de chamados</h1>
        <Button onClick={() => setCreating(true)}>Novo chamado</Button>
      </div>

      <Dialog open={creating} onClose={() => setCreating(false)} title="Novo chamado">
        <NewTicketForm
          onCreated={(id) => {
            setCreating(false);
            router.push(`/app/chamados/${id}`);
          }}
          onCancel={() => setCreating(false)}
        />
      </Dialog>

      <TicketTable />
    </div>
  );
}
