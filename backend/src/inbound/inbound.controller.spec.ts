import { Webhook } from 'standardwebhooks';
import { verifySvixSignature } from './inbound.controller.js';
import { htmlToText } from './resend-receiving.service.js';

// Segredo no formato do Resend/Svix; assinatura gerada pela lib de referência.
const SECRET = 'whsec_' + Buffer.from('segredo-de-teste-32-bytes-xxxxxx').toString('base64');
const wh = new Webhook(SECRET);
const RAW = '{"type":"email.received","data":{"email_id":"e1"}}';

function signed(raw = RAW, at = new Date()) {
  const id = 'msg_1';
  const timestamp = String(Math.floor(at.getTime() / 1000));
  return { id, timestamp, signature: wh.sign(id, at, raw) };
}

describe('verifySvixSignature', () => {
  it('assinatura da lib de referência → true', () => {
    expect(verifySvixSignature(Buffer.from(RAW), signed(), SECRET)).toBe(true);
  });

  it('aceita uma de várias assinaturas (rotação de segredo)', () => {
    const h = signed();
    h.signature = `v1,AAAA ${h.signature}`;
    expect(verifySvixSignature(Buffer.from(RAW), h, SECRET)).toBe(true);
  });

  it('corpo adulterado → false', () => {
    expect(verifySvixSignature(Buffer.from(RAW + ' '), signed(), SECRET)).toBe(false);
  });

  it('segredo errado → false', () => {
    const other = 'whsec_' + Buffer.from('outro').toString('base64');
    expect(verifySvixSignature(Buffer.from(RAW), signed(), other)).toBe(false);
  });

  it('timestamp fora da janela de 5 min → false (replay)', () => {
    const old = signed(RAW, new Date(Date.now() - 10 * 60_000));
    expect(verifySvixSignature(Buffer.from(RAW), old, SECRET)).toBe(false);
  });

  it('sem headers, sem corpo ou sem segredo → false (fail-closed)', () => {
    expect(verifySvixSignature(Buffer.from(RAW), {}, SECRET)).toBe(false);
    expect(verifySvixSignature(undefined, signed(), SECRET)).toBe(false);
    expect(verifySvixSignature(Buffer.from(RAW), signed(), '')).toBe(false);
  });
});

describe('htmlToText', () => {
  it('quebra linhas em <br>/<p>, remove tags/estilos e decodifica entidades', () => {
    const html =
      '<html><head><style>p{}</style></head><body><p>Olá&nbsp;equipe,</p><p>Impressora <b>parou</b><br>Sala 2 &amp; 3</p></body></html>';
    expect(htmlToText(html)).toBe('Olá equipe,\nImpressora parou\nSala 2 & 3');
  });

  it('vazio/null → string vazia', () => {
    expect(htmlToText(null)).toBe('');
  });
});
