import { EmailService } from './email.service.js';
import { contactInvite, ticketComment, ticketCreated } from './templates.js';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

const ticket = { number: '2026-0001', title: 'Impressora sem toner', status: 'OPEN' } as any;

/** Stub do SettingsService: `map` fornece os valores; ausente = undefined. */
function settings(map: Record<string, string | undefined>) {
  return {
    getMany: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, map[k]]))),
    get: vi.fn(async (k: string) => map[k]),
  } as any;
}

describe('EmailService.send', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: 'x' }, error: null });
    delete process.env.RESEND_API_KEY;
  });

  it('sem chave (banco nem env): não chama o Resend, só loga', async () => {
    const svc = new EmailService(settings({ 'mail.from': 'suporte@exemplo.com.br' }));
    const spy = vi.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});
    await svc.send({ to: 'a@a.com', subject: 'oi', html: '<p>x</p>' });
    expect(sendMock).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('RESEND_API_KEY ausente'));
  });

  it('chave vinda do banco (env sem nada): chama emails.send com from e replyTo default', async () => {
    const svc = new EmailService(
      settings({ 'resend.apiKey': 'rk_db', 'mail.from': 'suporte@exemplo.com.br' }),
    );
    await svc.send({ to: 'dest@a.com', subject: 'oi', html: '<p>x</p>' });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'suporte@exemplo.com.br',
        to: 'dest@a.com',
        replyTo: 'suporte@exemplo.com.br',
      }),
    );
  });

  it('repassa headers e replyTo explícito', async () => {
    const svc = new EmailService(settings({ 'resend.apiKey': 'rk', 'mail.from': 'f@a.com' }));
    await svc.send({
      to: 'd@a.com',
      subject: 's',
      html: 'h',
      headers: { References: '2026-0001' },
      replyTo: 'outro@a.com',
    });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: 'outro@a.com', headers: { References: '2026-0001' } }),
    );
  });

  it('erro do Resend não propaga', async () => {
    const svc = new EmailService(settings({ 'resend.apiKey': 'rk', 'mail.from': 'f@a.com' }));
    sendMock.mockRejectedValueOnce(new Error('boom'));
    vi.spyOn((svc as any).logger, 'error').mockImplementation(() => {});
    await expect(svc.send({ to: 'a@a.com', subject: 's', html: 'h' })).resolves.toBeUndefined();
  });
});

describe('EmailService.brand', () => {
  it('sem APP_URL: logoUrl fica undefined mesmo com logo salvo', async () => {
    delete process.env.APP_URL;
    const svc = new EmailService(
      settings({ 'branding.companyName': 'One Day', 'branding.logoData': 'AAA' }),
    );
    expect(await svc.brand()).toEqual({ companyName: 'One Day', logoUrl: undefined });
  });

  it('com APP_URL + logo: logoUrl aponta para /api/branding/logo', async () => {
    process.env.APP_URL = 'https://os.exemplo.com';
    const svc = new EmailService(settings({ 'branding.logoData': 'AAA' }));
    expect((await svc.brand()).logoUrl).toBe('https://os.exemplo.com/api/branding/logo');
  });
});

describe('templates', () => {
  it('ticketCreated inclui [#2026-0001] no subject', () => {
    expect(ticketCreated(ticket).subject).toContain('[#2026-0001]');
  });

  it('ticketComment escapa HTML de title e comment.body', () => {
    const { html } = ticketComment(
      { ...ticket, title: '<script>alert(1)</script>' },
      { body: '<img src=x onerror=alert(1)>' } as any,
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x onerror=');
  });

  it('contactInvite escapa HTML do user.name', () => {
    const { html } = contactInvite({ name: '<b>x</b>', email: 'a@a.com' }, 'https://x/def?t=1');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });

  it('wrap injeta logo e rodapé quando a marca é passada', () => {
    const { html } = ticketCreated(ticket, {
      companyName: 'One Day',
      logoUrl: 'https://os.exemplo.com/api/branding/logo',
    });
    expect(html).toContain('<img src="https://os.exemplo.com/api/branding/logo"');
    expect(html).toContain('One Day');
  });
});
