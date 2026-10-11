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

test('cadastra grupo e frase na ficha do cliente e cria chamado a partir de uma sugestão', async ({ page }) => {
  test.setTimeout(90_000);
  const stamp = Date.now();
  const jid = `${stamp}@g.us`;
  const phrase = `E2E Sistema caiu ${stamp}`;
  const prisma = new PrismaClient();

  await loginAsAdmin(page);

  // 1. Ficha do cliente → aba WhatsApp → grupo por ID
  await page.goto(`/app/clientes/${E2E_CLIENT_ID}`);
  await page.getByRole('button', { name: 'WhatsApp' }).click();
  await page.locator('#wg-id').fill('isso-nao-e-um-id');
  await page.getByRole('button', { name: 'Adicionar grupo' }).click();
  await expect(page.getByText(/ID inválido/)).toBeVisible();
  await page.locator('#wg-id').fill(jid);
  await page.locator('#wg-name').fill(`Suporte E2E ${stamp}`);
  await page.getByRole('button', { name: 'Adicionar grupo' }).click();
  await expect(page.getByText('Grupo cadastrado.')).toBeVisible();
  await expect(page.getByText(jid)).toBeVisible();

  // 2. Frase de gatilho
  await page.getByRole('button', { name: 'Nova frase' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova frase' });
  await dialog.locator('#ph-phrase').fill(phrase);
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Frase salva.')).toBeVisible();
  await expect(page.getByText(phrase)).toBeVisible();

  // 3. Sugestão da IA (semeada direto no banco — a IA real nunca roda em teste)
  const group = await prisma.whatsappGroup.findUniqueOrThrow({ where: { externalId: jid } });
  const resumo = `Impressora parada E2E ${stamp}`;
  await prisma.ticketSuggestion.create({
    data: {
      groupId: group.id, clientId: E2E_CLIENT_ID, messageIds: [], urgency: 4,
      summary: resumo, excerpt: 'Beto: a impressora do financeiro parou',
    },
  });

  // 4. Triagem → criar chamado
  await page.goto('/app/triagem');
  await expect(page.getByText(resumo)).toBeVisible();
  await page.locator('li', { hasText: resumo }).getByRole('button', { name: 'Criar chamado' }).click();
  await page.waitForURL(/\/app\/chamados\/.+/);
  await expect(page.getByText(resumo).first()).toBeVisible();

  await prisma.$disconnect();
});
