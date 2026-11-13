export type Severity = 'alta' | 'media' | 'baixa';
export interface Suggestion { rule: string; severity: Severity; title: string; detail: string }
export interface Thresholds { ramMinGb: number; diskFreePct: number; biosMaxYears: number; staleDays: number }

export const DEFAULT_THRESHOLDS: Thresholds = { ramMinGb: 8, diskFreePct: 15, biosMaxYears: 5, staleDays: 7 };

const rank: Record<Severity, number> = { baixa: 1, media: 2, alta: 3 };
export const maxSeverity = (s: Pick<Suggestion, 'severity'>[]): Severity | null =>
  s.reduce<Severity | null>((m, x) => (m == null || rank[x.severity] > rank[m] ? x.severity : m), null);

const obj = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Função pura: campo ausente nunca gera sugestão. */
export function evaluate(specs: unknown, now: Date, t: Thresholds): Suggestion[] {
  const s = obj(specs);
  const out: Suggestion[] = [];
  const add = (rule: string, severity: Severity, title: string, detail: string) =>
    out.push({ rule, severity, title, detail });

  const ram = num(s.ramGb);
  if (ram != null && ram < t.ramMinGb) {
    add('ram-baixa', 'media', 'Memória RAM baixa',
      `O equipamento tem ${ram} GB de RAM (mínimo recomendado: ${t.ramMinGb} GB). Considere ampliar a memória.`);
  }

  const discos = (Array.isArray(s.discos) ? s.discos : []).filter(
    (d: unknown): d is Record<string, any> => !!d && typeof d === 'object',
  );
  for (const d of discos) {
    const nome = d.nome ?? 'disco';
    if (d.sistema === true && d.tipo === 'HDD') {
      add('hdd', 'media', 'Disco do sistema é HDD',
        `O disco ${nome} (sistema) é mecânico. Trocar por SSD melhora muito o desempenho.`);
    }
    const tam = num(d.tamanhoGb);
    const livre = num(d.livreGb);
    if (d.sistema === true && tam && livre != null && (livre / tam) * 100 < t.diskFreePct) {
      add('disco-cheio', 'media', 'Pouco espaço livre no disco do sistema',
        `O disco ${nome} tem ${livre} GB livres de ${tam} GB (menos de ${t.diskFreePct}%). Libere espaço ou amplie o disco.`);
    }
    if (d.smart === 'Falha') {
      add('disco-falha', 'alta', 'Disco com falha (SMART)',
        `O disco ${nome} reporta falha no SMART. Faça backup e substitua o disco.`);
    } else if (d.smart === 'Atenção') {
      add('disco-atencao', 'media', 'Disco com alerta (SMART)',
        `O disco ${nome} reporta atenção no SMART. Acompanhe e planeje a troca.`);
    }
  }

  const so = obj(s.so);
  const edicao = typeof so.edicao === 'string' ? so.edicao : '';
  const build = parseInt(String(so.build ?? ''), 10);
  // Windows 10: pela edição, ou build < 22000 quando não é Server
  const w10 = /windows 10/i.test(edicao) || (Number.isFinite(build) && build < 22000 && !/server/i.test(edicao));
  if (w10) {
    add('windows-sem-suporte', 'alta', 'Windows 10 sem suporte',
      'O Windows 10 não recebe mais atualizações de segurança gratuitas. Atualize para o Windows 11 ou substitua o equipamento.');

    const tpm = obj(s.tpm);
    const motivos: string[] = [];
    if (tpm.presente === false) motivos.push('sem TPM');
    else if (typeof tpm.versao === 'string' && tpm.versao.trim() && !tpm.versao.trim().startsWith('2')) {
      motivos.push(`TPM ${tpm.versao} (precisa de 2.0)`);
    }
    if (s.uefi === false) motivos.push('BIOS em modo legado (sem UEFI)');
    if (ram != null && ram < 4) motivos.push(`${ram} GB de RAM (mínimo 4 GB)`);
    if (motivos.length) {
      add('sem-win11', 'media', 'Não atende aos requisitos do Windows 11',
        `Não atende: ${motivos.join('; ')}. A CPU não é avaliada (não coletada), então podem existir outros impeditivos. Planeje a troca do equipamento.`);
    }
  }

  const bios = obj(s.bios);
  const bd = typeof bios.data === 'string' ? new Date(bios.data) : null;
  if (bd && !isNaN(bd.getTime())) {
    const limite = new Date(now);
    limite.setUTCFullYear(limite.getUTCFullYear() - t.biosMaxYears);
    if (bd < limite) {
      add('equipamento-antigo', 'baixa', 'Equipamento antigo',
        `A BIOS é de ${bios.data}, com mais de ${t.biosMaxYears} anos. Planeje a renovação do equipamento.`);
    }
  }
  return out;
}
