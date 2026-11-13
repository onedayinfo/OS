import { evaluate, DEFAULT_THRESHOLDS as T, maxSeverity } from './improvements.js';

const now = new Date('2026-11-13T12:00:00Z');
const rules = (specs: unknown) => evaluate(specs, now, T).map((s) => s.rule);
const sysDisk = (o: object) => ({ discos: [{ nome: 'C:', tamanhoGb: 100, sistema: true, ...o }] });

describe('evaluate', () => {
  it('specs vazio/incompleto/inválido não gera nada', () => {
    for (const s of [null, undefined, {}, 'x', 5, [], { discos: 'x' }, { discos: [null] }]) expect(rules(s)).toEqual([]);
  });

  it('ram-baixa: abaixo do limiar dispara, no limiar não', () => {
    expect(rules({ ramGb: 4 })).toContain('ram-baixa');
    expect(rules({ ramGb: 8 })).not.toContain('ram-baixa');
    expect(rules({})).not.toContain('ram-baixa');
  });

  it('hdd: só disco do sistema', () => {
    expect(rules(sysDisk({ tipo: 'HDD' }))).toContain('hdd');
    expect(rules(sysDisk({ tipo: 'SSD' }))).not.toContain('hdd');
    expect(rules(sysDisk({ tipo: 'HDD', sistema: false }))).not.toContain('hdd');
  });

  it('disco-cheio: borda de 15%', () => {
    expect(rules(sysDisk({ livreGb: 14 }))).toContain('disco-cheio');
    expect(rules(sysDisk({ livreGb: 15 }))).not.toContain('disco-cheio');
    expect(rules(sysDisk({ livreGb: 5, sistema: false }))).not.toContain('disco-cheio');
    expect(rules(sysDisk({}))).not.toContain('disco-cheio');
  });

  it('disco-falha (alta) e disco-atencao (média)', () => {
    const f = evaluate({ discos: [{ nome: 'D:', tamanhoGb: 1, smart: 'Falha' }] }, now, T);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ rule: 'disco-falha', severity: 'alta' });
    const a = evaluate({ discos: [{ nome: 'D:', tamanhoGb: 1, smart: 'Atenção' }] }, now, T);
    expect(a[0]).toMatchObject({ rule: 'disco-atencao', severity: 'media' });
  });

  it('windows-sem-suporte por edição ou build', () => {
    expect(rules({ so: { edicao: 'Microsoft Windows 10 Pro' } })).toContain('windows-sem-suporte');
    expect(rules({ so: { build: '19045' } })).toContain('windows-sem-suporte');
    expect(rules({ so: { edicao: 'Windows 11 Pro', build: '22631' } })).not.toContain('windows-sem-suporte');
    expect(rules({ so: { edicao: 'Windows Server 2019', build: '17763' } })).not.toContain('windows-sem-suporte');
  });

  it('sem-win11: só no Windows 10 e com requisito falho conhecido', () => {
    const w10 = { so: { edicao: 'Windows 10 Pro' } };
    expect(rules({ ...w10, tpm: { presente: false } })).toContain('sem-win11');
    expect(rules({ ...w10, tpm: { presente: true, versao: '1.2' } })).toContain('sem-win11');
    expect(rules({ ...w10, uefi: false })).toContain('sem-win11');
    expect(rules({ ...w10, ramGb: 2 })).toContain('sem-win11');
    expect(rules({ ...w10, tpm: { presente: true, versao: '2.0' }, uefi: true, ramGb: 8 })).not.toContain('sem-win11');
    expect(rules(w10)).not.toContain('sem-win11');
    expect(rules({ so: { edicao: 'Windows 11' }, uefi: false })).not.toContain('sem-win11');
  });

  it('equipamento-antigo: BIOS com mais de 5 anos', () => {
    expect(rules({ bios: { data: '2021-11-12' } })).toContain('equipamento-antigo');
    expect(rules({ bios: { data: '2021-11-14' } })).not.toContain('equipamento-antigo');
    expect(rules({ bios: { data: 'lixo' } })).toEqual([]);
  });

  it('respeita limiares customizados', () => {
    expect(evaluate({ ramGb: 8 }, now, { ...T, ramMinGb: 16 }).map((s) => s.rule)).toContain('ram-baixa');
  });

  it('maxSeverity', () => {
    expect(maxSeverity([])).toBeNull();
    expect(maxSeverity([{ severity: 'baixa' }, { severity: 'alta' }] as any)).toBe('alta');
  });
});
