import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { WhatsappWebhookController, verifyWebhookSecret } from './whatsapp-webhook.controller.js';

describe('verifyWebhookSecret', () => {
  it('só aceita o segredo exato; fail-closed sem segredo configurado', () => {
    expect(verifyWebhookSecret('abc', 'abc')).toBe(true);
    expect(verifyWebhookSecret('abd', 'abc')).toBe(false);
    expect(verifyWebhookSecret(undefined, 'abc')).toBe(false);
    expect(verifyWebhookSecret('', '')).toBe(false);
    expect(verifyWebhookSecret('x', '')).toBe(false);
  });
});

const payload = {
  event: 'messages.upsert',
  data: {
    key: { remoteJid: '1203630@g.us', fromMe: false, id: 'A1', participant: '5519999991234@s.whatsapp.net' },
    message: { conversation: 'Sistema caiu' },
    messageTimestamp: 1760000000,
  },
};
const req = (body: unknown) => ({ rawBody: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) }) as any;

function make(secret = 's3gredo') {
  const whatsapp = { ingest: vi.fn().mockResolvedValue({ stored: true, ticketId: null }) };
  const settings = { get: vi.fn().mockResolvedValue(secret) };
  return { ctrl: new WhatsappWebhookController(whatsapp as any, settings as any), whatsapp };
}

describe('WhatsappWebhookController', () => {
  it('segredo errado → 401 e nada é processado', async () => {
    const { ctrl, whatsapp } = make();
    await expect(ctrl.receive(req(payload), 'errado')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(whatsapp.ingest).not.toHaveBeenCalled();
  });

  it('JSON inválido → 400', async () => {
    const { ctrl } = make();
    await expect(ctrl.receive(req('{nao-json'), 's3gredo')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('evento que não interessa → ignored, sem ingerir', async () => {
    const { ctrl, whatsapp } = make();
    expect(await ctrl.receive(req({ event: 'connection.update' }), 's3gredo')).toEqual({ ignored: true });
    expect(whatsapp.ingest).not.toHaveBeenCalled();
  });

  it('mensagem de grupo válida → ingere', async () => {
    const { ctrl, whatsapp } = make();
    await ctrl.receive(req(payload), 's3gredo');
    expect(whatsapp.ingest).toHaveBeenCalledWith(expect.objectContaining({ groupJid: '1203630@g.us', body: 'Sistema caiu' }));
  });
});
