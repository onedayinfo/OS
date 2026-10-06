'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TicketTable } from '@/components/ticket-table';
import { NewTicketForm } from '@/components/new-ticket-form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

export default function AppQueuePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (searchParams.get('novo') === '1') {
      setCreating(true);
      router.replace('/app');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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
