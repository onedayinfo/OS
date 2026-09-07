/** Token de injeção: `@Inject('MailSender')`. Impl real: `ResendMailSender` (Fase 8). */
export interface MailSender {
  sendInvite(user: { name: string; email: string }, link: string): Promise<void>;
}
