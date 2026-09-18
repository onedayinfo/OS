'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import {
  useCheckIn,
  useCheckOut,
  useCloseVisit,
  useSetChecklist,
  useUploadVisitAttachment,
  useVisit,
} from '@/lib/visits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SignaturePad } from '@/components/signature-pad';

function onErr(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
}

function geolocate(): Promise<{ lat?: number; lng?: number }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({}),
      { timeout: 5000 },
    );
  });
}

export default function VisitExecutionPage({ params }: { params: { visitId: string } }) {
  const { visitId } = params;
  const router = useRouter();
  const { data: visit, isLoading } = useVisit(visitId);
  const checkIn = useCheckIn(visitId);
  const checkOut = useCheckOut(visitId);
  const setChecklist = useSetChecklist(visitId);
  const close = useCloseVisit(visitId);
  const upload = useUploadVisitAttachment(visitId);
  const [answers, setAnswers] = useState<Record<string, { done: boolean; note: string }>>({});

  if (isLoading || !visit) return <p className="p-3 text-sm text-muted-foreground">Carregando…</p>;

  const hasSignature = visit.attachments.some((a) => a.kind === 'SIGNATURE');
  const items = visit.checklistTemplate?.items ?? [];
  const answered = (itemId: string) =>
    answers[itemId] ?? visit.checklistAnswers.find((a) => a.itemId === itemId) ?? { done: false, note: '' };
  const allAnswered =
    items.length > 0 &&
    items.every((i) => Boolean(answers[i.id]) || visit.checklistAnswers.some((a) => a.itemId === i.id));

  async function doCheckIn() {
    const geo = await geolocate();
    checkIn.mutate(geo, { onSuccess: () => toast.success('Check-in feito.'), onError: onErr });
  }

  async function doCheckOut() {
    const geo = await geolocate();
    checkOut.mutate(geo, { onSuccess: () => toast.success('Check-out feito.'), onError: onErr });
  }

  function saveChecklist() {
    setChecklist.mutate(
      { answers: items.map((i) => ({ itemId: i.id, done: answered(i.id).done, note: answered(i.id).note || undefined })) },
      { onSuccess: () => toast.success('Checklist salvo.'), onError: onErr },
    );
  }

  function doClose() {
    close.mutate(undefined, {
      onSuccess: () => {
        toast.success('Visita fechada — laudo enviado ao cliente.');
        router.push('/app/campo');
      },
      onError: onErr,
    });
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      <div>
        <p className="text-xs text-muted-foreground">#{visit.ticket.number}</p>
        <h1 className="text-lg font-semibold">{visit.ticket.title}</h1>
        <p className="text-sm text-muted-foreground">
          {visit.ticket.client?.name} {visit.ticket.location?.name ? `· ${visit.ticket.location.name}` : ''}
        </p>
      </div>

      {visit.status === 'SCHEDULED' && (
        <Button className="h-11" disabled={checkIn.isPending} onClick={doCheckIn}>
          Check-in
        </Button>
      )}

      {visit.status !== 'SCHEDULED' && (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Checklist</h2>
            {items.map((item) => {
              const a = answered(item.id);
              return (
                <div key={item.id} className="flex flex-col gap-1 rounded-md border border-border p-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={a.done}
                      onChange={(e) =>
                        setAnswers((prev) => ({ ...prev, [item.id]: { done: e.target.checked, note: a.note } }))
                      }
                    />
                    {item.label}
                  </label>
                  <Input
                    placeholder="Observação (opcional)"
                    className="h-8 text-xs"
                    defaultValue={a.note}
                    onBlur={(e) =>
                      setAnswers((prev) => ({ ...prev, [item.id]: { done: a.done, note: e.target.value } }))
                    }
                  />
                </div>
              );
            })}
            <Button variant="outline" className="h-9" disabled={setChecklist.isPending} onClick={saveChecklist}>
              Salvar checklist
            </Button>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Fotos</h2>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate({ file, kind: 'PHOTO_AFTER' }, { onError: onErr });
              }}
            />
            <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
              {visit.attachments.filter((a) => a.kind === 'PHOTO_BEFORE' || a.kind === 'PHOTO_AFTER').map((a) => (
                <span key={a.id}>📷 {a.filename}</span>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Assinatura do cliente</h2>
            {hasSignature ? (
              <p className="text-sm text-green-700">Assinatura registrada.</p>
            ) : (
              <SignaturePad
                onCapture={(file) => upload.mutate({ file, kind: 'SIGNATURE' }, { onError: onErr })}
              />
            )}
          </section>

          {visit.status === 'IN_PROGRESS' && !visit.checkOutAt && (
            <Button className="h-11" disabled={checkOut.isPending} onClick={doCheckOut}>
              Check-out
            </Button>
          )}

          {visit.status === 'IN_PROGRESS' && visit.checkOutAt && (
            <Button className="h-11" disabled={close.isPending || !allAnswered || !hasSignature} onClick={doClose}>
              Fechar visita
            </Button>
          )}

          {visit.status === 'DONE' && (
            <p className="text-sm text-green-700">
              Visita concluída{visit.reportSentAt ? ' — laudo enviado.' : '.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
