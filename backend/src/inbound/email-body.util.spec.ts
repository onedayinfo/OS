import { stripQuotedText } from './email-body.util.js';

describe('stripQuotedText', () => {
  it('remove citação (linhas >) e bloco após "Em ... escreveu:"', () => {
    const input = [
      'Oi, segue o retorno.',
      'Obrigado!',
      '',
      'Em 6 de setembro de 2026 10:00, Suporte <suporte@x.com> escreveu:',
      '> Seu chamado foi aberto.',
      '> Número 2026-0001.',
    ].join('\n');

    expect(stripQuotedText(input)).toBe('Oi, segue o retorno.\nObrigado!');
  });

  it('remove bloco após "On ... wrote:"', () => {
    const input = 'Resposta curta.\n\nOn Mon, Sep 7, 2026 at 9:00 AM John wrote:\n> old stuff';
    expect(stripQuotedText(input)).toBe('Resposta curta.');
  });

  it('remove linhas > mesmo sem marcador', () => {
    expect(stripQuotedText('linha util\n> citada\noutra util')).toBe('linha util\noutra util');
  });

  it('texto sem citação volta só com trim', () => {
    expect(stripQuotedText('  texto  \n')).toBe('texto');
  });

  it('string vazia/nula', () => {
    expect(stripQuotedText('')).toBe('');
    expect(stripQuotedText(undefined as unknown as string)).toBe('');
  });
});
