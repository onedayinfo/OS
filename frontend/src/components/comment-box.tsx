'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useAddComment, type CommentVisibility } from '@/lib/tickets';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export function CommentBox({ ticketId }: { ticketId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<CommentVisibility>('INTERNAL');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const addComment = useAddComment(ticketId);

  async function submit() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await addComment.mutateAsync({ body: body.trim(), visibility });
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        await api(`/tickets/${ticketId}/attachments`, { method: 'POST', body: fd });
      }
      qc.invalidateQueries({ queryKey: ['ticket', ticketId] });
      setBody('');
      setFiles([]);
      if (fileInput.current) fileInput.current.value = '';
      toast.success('Comentário adicionado.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Falha ao enviar o comentário.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex gap-1">
        {(['INTERNAL', 'PUBLIC'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setVisibility(v)}
            className={cn(
              'rounded-md px-3 py-1 text-sm font-medium',
              visibility === v
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {v === 'INTERNAL' ? 'Interno' : 'Público'}
          </button>
        ))}
      </div>
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={
          visibility === 'INTERNAL'
            ? 'Nota interna (não visível ao cliente)'
            : 'Resposta visível ao cliente'
        }
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        className="text-sm"
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
      />
      <div className="flex justify-end">
        <Button className="h-9" disabled={busy || !body.trim()} onClick={submit}>
          {busy ? 'Enviando…' : 'Enviar'}
        </Button>
      </div>
    </div>
  );
}
