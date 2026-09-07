import { EmailService } from './email.service.js';
import { ticketCreated } from './templates.js';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

const ticket = { number: '2026-0001', title: 'Impressora sem toner', status: 'OPEN' } as any;

describe('EmailService.send', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: 'x' }, error: null });
    process.env.MAIL_FROM = 'suporte@exemplo.com.br';
  });

  it('sem RESEND_API_KEY: não chama o Resend, só loga', async () => {
    delete process.env.RESEND_API_KEY;
    const svc = new EmailService();
    const spy = vi.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});
    await svc.send({ to: 'a@a.com', subject: 'oi', html: '<p>x</p>' });
    expect(sendMock).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('RESEND_API_KEY ausente'));
  });

  it('com key: chama emails.send com from=MAIL_FROM e replyTo default', async () => {
    process.env.RESEND_API_KEY = 'rk_test';
    await new EmailService().send({ to: 'dest@a.com', subject: 'oi', html: '<p>x</p>' });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'suporte@exemplo.com.br',
        to: 'dest@a.com',
        replyTo: 'suporte@exemplo.com.br',
      }),
    );
  });

  it('repassa headers e replyTo explícito', async () => {
    process.env.RESEND_API_KEY = 'rk_test';
    await new EmailService().send({
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
    process.env.RESEND_API_KEY = 'rk_test';
    sendMock.mockRejectedValueOnce(new Error('boom'));
    const svc = new EmailService();
    vi.spyOn((svc as any).logger, 'error').mockImplementation(() => {});
    await expect(svc.send({ to: 'a@a.com', subject: 's', html: 'h' })).resolves.toBeUndefined();
  });
});

describe('templates', () => {
  it('ticketCreated inclui [#2026-0001] no subject', () => {
    expect(ticketCreated(ticket).subject).toContain('[#2026-0001]');
  });
});
