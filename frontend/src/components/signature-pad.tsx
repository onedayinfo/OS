'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

/** Canvas de assinatura: desenha com o dedo/mouse, exporta como PNG (`File`). Sem lib nova. */
export function SignaturePad({ onCapture }: { onCapture: (file: File) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  }

  function end() {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current!;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  function capture() {
    canvasRef.current!.toBlob((blob) => {
      if (blob) onCapture(new File([blob], 'assinatura.png', { type: 'image/png' }));
    }, 'image/png');
  }

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        width={320}
        height={160}
        className="touch-none rounded-md border border-input bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="h-9" onClick={clear}>
          Limpar
        </Button>
        <Button type="button" className="h-9" disabled={!hasDrawn} onClick={capture}>
          Confirmar assinatura
        </Button>
      </div>
    </div>
  );
}
