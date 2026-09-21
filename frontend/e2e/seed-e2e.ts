// globalSetup do Playwright: garante um contato de cliente e um ADMIN da equipe
// com senhas conhecidas para os smokes E2E. Idempotente (upsert) e com limpeza
// no teardown.
//
// Usa o PrismaClient e o bcrypt já instalados no backend — sem duplicar deps no
// frontend. DATABASE_URL vem do ambiente (carregado pelo playwright.config.ts a
// partir de backend/.env).
import bcrypt from '../../backend/node_modules/bcrypt/bcrypt.js';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/index.js';

export const E2E_EMAIL = 'contato@e2e.test';
export const E2E_PASSWORD = 'e2e12345';
export const E2E_ADMIN_EMAIL = 'admin@e2e.test';
export const E2E_ADMIN_PASSWORD = 'e2e12345';
export const E2E_AGENT_EMAIL = 'agente@e2e.test';
export const E2E_AGENT_PASSWORD = 'e2e12345';
export const E2E_ASSET_TYPE = 'Câmera E2E';
const E2E_CLIENT_ID = 'e2e-client';
const E2E_DOMAIN = 'e2e.test';

async function cleanup(prisma: InstanceType<typeof PrismaClient>): Promise<void> {
  // TicketSatisfactionSurvey não tem onDelete: Cascade na FK pro ticket —
  // precisa sumir antes, senão trava o deleteMany de Ticket abaixo.
  await prisma.ticketSatisfactionSurvey.deleteMany({
    where: { ticket: { clientId: E2E_CLIENT_ID } },
  });
  // Eventos/comentários e vínculos m2m somem em cascata com o ticket.
  await prisma.ticket.deleteMany({ where: { clientId: E2E_CLIENT_ID } });
  // Contratos (e seus overrides de SLA, em cascata) travam a FK do client se não forem removidos antes.
  await prisma.contract.deleteMany({ where: { clientId: E2E_CLIENT_ID } });
  // Idem para orçamentos — o chamado gerado por aprovação avulsa já some no
  // deleteMany de Ticket acima, mas o próprio Quote (itens em cascata) trava
  // a FK do client se não for removido antes.
  await prisma.quote.deleteMany({ where: { clientId: E2E_CLIENT_ID } });
  await prisma.asset.deleteMany({ where: { clientId: E2E_CLIENT_ID } });
  await prisma.location.deleteMany({ where: { clientId: E2E_CLIENT_ID } });
  await prisma.user.deleteMany({ where: { email: { in: [E2E_EMAIL, E2E_ADMIN_EMAIL, E2E_AGENT_EMAIL] } } });
  await prisma.client.deleteMany({ where: { id: E2E_CLIENT_ID } });
  await prisma.assetType.deleteMany({ where: { name: E2E_ASSET_TYPE } });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const prisma = new PrismaClient();

  await prisma.client.upsert({
    where: { id: E2E_CLIENT_ID },
    update: { active: true, emailDomains: [E2E_DOMAIN] },
    create: { id: E2E_CLIENT_ID, name: 'Cliente E2E', emailDomains: [E2E_DOMAIN] },
  });

  const passwordHash = await bcrypt.hash(E2E_PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: E2E_EMAIL },
    update: { passwordHash, active: true, clientId: E2E_CLIENT_ID, role: 'CONTACT', type: 'CLIENT' },
    create: {
      name: 'Contato E2E',
      email: E2E_EMAIL,
      passwordHash,
      type: 'CLIENT',
      role: 'CONTACT',
      active: true,
      clientId: E2E_CLIENT_ID,
    },
  });

  const adminHash = await bcrypt.hash(E2E_ADMIN_PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: E2E_ADMIN_EMAIL },
    update: { passwordHash: adminHash, active: true, role: 'ADMIN', type: 'INTERNAL', clientId: null },
    create: {
      name: 'Admin E2E',
      email: E2E_ADMIN_EMAIL,
      passwordHash: adminHash,
      type: 'INTERNAL',
      role: 'ADMIN',
      active: true,
    },
  });

  const agentHash = await bcrypt.hash(E2E_AGENT_PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: E2E_AGENT_EMAIL },
    update: { passwordHash: agentHash, active: true, role: 'AGENT', type: 'INTERNAL', clientId: null },
    create: {
      name: 'Agente E2E',
      email: E2E_AGENT_EMAIL,
      passwordHash: agentHash,
      type: 'INTERNAL',
      role: 'AGENT',
      active: true,
    },
  });

  await prisma.assetType.upsert({
    where: { name: E2E_ASSET_TYPE },
    update: { active: true },
    create: { name: E2E_ASSET_TYPE, active: true },
  });

  // O seed do backend já cria categorias; garante ao menos uma ativa mesmo assim.
  if ((await prisma.category.count({ where: { active: true } })) === 0) {
    await prisma.category.create({ data: { name: 'Geral', active: true } });
  }

  await prisma.$disconnect();

  return async () => {
    const teardown = new PrismaClient();
    try {
      await cleanup(teardown);
    } finally {
      await teardown.$disconnect();
    }
  };
}
