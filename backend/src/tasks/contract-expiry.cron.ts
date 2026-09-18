import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import { contractExpiring } from '../email/templates.js';

const WARNING_WINDOW_DAYS = 30;

/** Avisa os ADMIN por e-mail quando um contrato está a ≤30 dias do fim da vigência. Uma vez por contrato. */
@Injectable()
export class ContractExpiryCron {
  private readonly logger = new Logger(ContractExpiryCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  @Cron('0 8 * * *')
  async run(): Promise<void> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + WARNING_WINDOW_DAYS * 24 * 3600_000);
    const expiring = await this.prisma.contract.findMany({
      where: {
        status: 'ACTIVE',
        endDate: { gte: now, lte: windowEnd },
        renewalWarnedAt: null,
      },
      include: { client: { select: { name: true } } },
    });
    if (!expiring.length) return;

    const admins = await this.prisma.user.findMany({
      where: { type: 'INTERNAL', role: 'ADMIN', active: true },
    });
    const brand = await this.email.brand();

    for (const contract of expiring) {
      try {
        const tpl = contractExpiring(contract, brand);
        for (const admin of admins) {
          await this.email.send({ to: admin.email, ...tpl });
        }
        await this.prisma.contract.update({
          where: { id: contract.id },
          data: { renewalWarnedAt: now },
        });
      } catch (err) {
        this.logger.error(
          `Falha ao avisar vencimento do contrato ${contract.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }
}
