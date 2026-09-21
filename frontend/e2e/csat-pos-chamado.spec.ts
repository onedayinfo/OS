import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/index.js';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './seed-e2e';

// Smoke E2E da fase 0.7.0 parte 1/4: fechar um chamado gera a pesquisa de
// satisfação; o link público (lido via Prisma, já que não há provedor de
// e-mail em dev/E2E) permite responder sem login, e a nota aparece na ficha.
async function loginAsAdmin(page: Page) {
  await page.goto('/app/login');
  await page.locator('#email').fill(E2E_ADMIN_EMAIL);
  await page.locator('#password').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/app');
}

test('fechar chamado gera pesquisa; responder pelo link mostra a nota na ficha', async ({ page }) => {
  test.setTimeout(90_000); // servidor Next em produção "frio" + várias navegações
  const titulo = `Chamado CSAT E2E ${Date.now()}`;

  await loginAsAdmin(page);

  // Novo chamado — selects na ordem do form: 0 Cliente, 1 Solicitante, 2
  // Categoria, 3 Prioridade, 4 Local (mesmo padrão de app-local-ativo-chamado).
  await page.goto('/app/chamados/novo');
  await page.locator('select').nth(0).selectOption({ label: 'Cliente E2E' });
  await page.locator('select').nth(1).selectOption({ index: 1 }); // solicitante (único contato)
  await page.locator('#title').fill(titulo);
  await page.locator('#desc').fill('Descrição de teste E2E.');
  await page.getByRole('button', { name: 'Criar chamado' }).click();
  await page.waitForURL(/\/app\/chamados\/(?!novo)[^/]+$/);

  const ticketId = page.url().split('/').pop()!;

  await page.getByLabel('Status').selectOption('RESOLVED');
  await page.getByLabel('Status').selectOption('CLOSED');
  await expect(page.getByText('Aguardando resposta do cliente.')).toBeVisible();

  const prisma = new PrismaClient();
  const survey = await prisma.ticketSatisfactionSurvey.findUnique({ where: { ticketId } });
  await prisma.$disconnect();
  expect(survey).not.toBeNull();

  await page.goto(`/pesquisa/${survey!.publicToken}`);
  await page.getByRole('button', { name: '5', exact: true }).click();
  await page.getByPlaceholder('Comentário (opcional)').fill('Muito bom atendimento');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText('Obrigado pela resposta!')).toBeVisible();

  await page.goto(`/app/chamados/${ticketId}`);
  await expect(page.getByText('⭐ 5/5')).toBeVisible();
  await expect(page.getByText('Muito bom atendimento')).toBeVisible();
});
