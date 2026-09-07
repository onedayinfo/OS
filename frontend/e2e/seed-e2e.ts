// globalSetup do Playwright: garante um contato de cliente com senha conhecida
// para o smoke E2E. Idempotente (upsert) e com limpeza no teardown.
//
// Usa o PrismaClient e o bcrypt já instalados no backend — sem duplicar deps no
// frontend. DATABASE_URL vem do ambiente (carregado pelo playwright.config.ts a
// partir de backend/.env).
import bcrypt from '../../backend/node_modules/bcrypt/bcrypt.js';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/index.js';

export const E2E_EMAIL = 'contato@e2e.test';
export const E2E_PASSWORD = 'e2e12345';
const E2E_CLIENT_ID = 'e2e-client';
const E2E_DOMAIN = 'e2e.test';

async function cleanup(prisma: InstanceType<typeof PrismaClient>): Promise<void> {
  // Eventos/comentários somem em cascata com o ticket.
  await prisma.ticket.deleteMany({ where: { clientId: E2E_CLIENT_ID } });
  await prisma.user.deleteMany({ where: { email: E2E_EMAIL } });
  await prisma.client.deleteMany({ where: { id: E2E_CLIENT_ID } });
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
