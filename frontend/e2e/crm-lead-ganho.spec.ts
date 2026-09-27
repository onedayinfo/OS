import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './seed-e2e';

async function loginAsAdmin(page: Page) {
  await page.goto('/app/login');
  await page.locator('#email').fill(E2E_ADMIN_EMAIL);
  await page.locator('#password').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/app');
}

test('lead vira oportunidade, recebe nota, e ao ganhar vira cliente', async ({ page }) => {
  test.setTimeout(90_000);
  const stamp = Date.now();
  const titulo = `Lead E2E ${stamp}`;
  const empresa = `Lead E2E Empresa ${stamp}`;

  await loginAsAdmin(page);

  // 1. Board do CRM → nova oportunidade de lead
  await page.goto('/app/crm');
  await page.getByRole('button', { name: 'Nova oportunidade' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova oportunidade' });
  await dialog.locator('#op-title').fill(titulo);
  await dialog.locator('#op-lead-name').fill('Fulano de Tal');
  await dialog.locator('#op-lead-company').fill(empresa);
  await dialog.getByRole('button', { name: 'Criar oportunidade' }).click();
  await page.waitForURL(/\/app\/crm\/(?!novo)[^/]+$/);

  // 2. Ficha → adiciona nota
  await page.getByPlaceholder('Nova nota…').fill('Primeira ligação feita.');
  await page.getByRole('button', { name: 'Adicionar nota' }).click();
  await expect(page.getByText('Nota adicionada.')).toBeVisible();
  await expect(page.getByText('Primeira ligação feita.')).toBeVisible();

  // 3. Muda estágio pra Ganho
  await page.getByRole('combobox').filter({ hasText: 'Mudar para…' }).selectOption({ label: 'Ganho' });
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Estágio atualizado.')).toBeVisible();
  await expect(page.getByText('Ganho', { exact: true })).toBeVisible();

  // 4. Cliente novo aparece em /app/clientes (busca pelo nome — evita depender
  // da ordem alfabética da paginação quando há muitos clientes no banco)
  await page.goto('/app/clientes');
  await page.getByPlaceholder('Buscar por nome').fill(empresa);
  await expect(page.getByText(empresa)).toBeVisible();
});
