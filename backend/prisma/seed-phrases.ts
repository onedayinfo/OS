import type { PrismaClient, TicketPriority } from '@prisma/client';

const FLAG = 'whatsapp.defaultPhrasesSeeded';

export const DEFAULT_PHRASES: { phrase: string; priority: TicketPriority }[] = [
  { phrase: 'Sistema caiu', priority: 'URGENT' },
  { phrase: 'Sem conexão', priority: 'HIGH' },
  { phrase: 'Sem internet', priority: 'HIGH' },
  { phrase: 'Wi-Fi caiu', priority: 'HIGH' },
  { phrase: 'Servidor fora do ar', priority: 'URGENT' },
  { phrase: 'Computador não liga', priority: 'MEDIUM' },
  { phrase: 'Impressora parada', priority: 'MEDIUM' },
  { phrase: 'Câmera offline', priority: 'HIGH' },
  { phrase: 'Alarme disparado', priority: 'URGENT' },
  { phrase: 'Cerca/portão parado', priority: 'HIGH' },
];

/** Mesma regra do `normalizeText` do sistema (src/whatsapp/text.util.ts). */
export function normalizePhrase(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Semeia as frases de gatilho globais UMA vez. A flag em `Setting` impede que uma frase
 * apagada pelo admin volte no próximo boot (o seed roda a cada subida do container).
 */
export async function seedDefaultPhrases(
  prisma: Pick<PrismaClient, 'setting' | 'triggerPhrase'>,
): Promise<{ created: number; skipped: boolean }> {
  if (await prisma.setting.findUnique({ where: { key: FLAG } })) return { created: 0, skipped: true };

  let created = 0;
  for (const p of DEFAULT_PHRASES) {
    const phraseNorm = normalizePhrase(p.phrase);
    // NULL não conflita no índice único: a duplicidade das globais é checada aqui.
    if (await prisma.triggerPhrase.findFirst({ where: { clientId: null, phraseNorm } })) continue;
    await prisma.triggerPhrase.create({
      data: { clientId: null, phrase: p.phrase, phraseNorm, priority: p.priority, categoryId: null, title: null },
    });
    created++;
  }
  await prisma.setting.create({ data: { key: FLAG, value: 'true', encrypted: false } });
  return { created, skipped: false };
}
