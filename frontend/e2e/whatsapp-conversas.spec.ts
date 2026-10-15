import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/index.js';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_CLIENT_ID } from './seed-e2e';

async function loginAsAdmin(page: Page) {
  await page.goto('/app/login');
  await page.locator('#email').fill(E2E_ADMIN_EMAIL);
  await page.locator('#password').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/app');
}

test('Triagem mostra as conversas do dia por cliente, corta em 300 letras e troca de data', async ({ page }) => {
  const stamp = Date.now();
  const prisma = new PrismaClient();
  const group = await prisma.whatsappGroup.create({
    data: { externalId: `${stamp}@g.us`, name: `Conversas E2E ${stamp}`, clientId: E2E_CLIENT_ID },
  });
  const cliente = await prisma.client.findUniqueOrThrow({ where: { id: E2E_CLIENT_ID } });
  const longo = 'a'.repeat(400);
  await prisma.whatsappMessage.createMany({
    data: [
      { externalId: `${stamp}-1`, groupId: group.id, senderName: 'Beto', type: 'TEXT', body: 'bom dia equipe', sentAt: new Date(Date.now() - 60_000), aiStatus: 'SKIPPED' },
      { externalId: `${stamp}-2`, groupId: group.id, senderName: 'Ana', type: 'TEXT', body: longo, sentAt: new Date(Date.now() - 30_000) },
      { externalId: `${stamp}-3`, groupId: group.id, senderName: 'Caio', type: 'AUDIO', sentAt: new Date(Date.now() - 10_000) },
    ],
  });

  try {
    await loginAsAdmin(page);
    await page.goto('/app/triagem');
    await page.getByRole('button', { name: new RegExp(`^${cliente.name}`) }).click();
    await expect(page.getByText(`Conversas E2E ${stamp}`)).toBeVisible();
    await expect(page.getByText('bom dia equipe')).toBeVisible();
    await expect(page.getByText('Ignorada')).toBeVisible();
    await expect(page.getByText('🎤 áudio')).toBeVisible();
    // corte em 300 letras + ver mais
    await expect(page.getByText(`${'a'.repeat(300)}…`)).toBeVisible();
    await page.getByRole('button', { name: 'ver mais' }).click();
    await expect(page.getByText(longo)).toBeVisible();
    // dia sem mensagens
    await page.getByLabel('Data das conversas').fill('2020-01-01');
    await expect(page.getByText('Nenhuma mensagem nos grupos neste dia.')).toBeVisible();
  } finally {
    await prisma.whatsappGroup.delete({ where: { id: group.id } });
    await prisma.$disconnect();
  }
});
