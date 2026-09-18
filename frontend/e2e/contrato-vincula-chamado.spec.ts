import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './seed-e2e';

async function loginAsAdmin(page: Page) {
  await page.goto('/app/login');
  await page.locator('#email').fill(E2E_ADMIN_EMAIL);
  await page.locator('#password').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/app');
}

test('contrato com local no escopo vincula o chamado automaticamente', async ({ page }) => {
  test.setTimeout(90_000);
  const stamp = Date.now();
  const local = `Local Contrato E2E ${stamp}`;
  const nomeContrato = `Contrato E2E ${stamp}`;
  const titulo = `Chamado contrato E2E ${stamp}`;

  await loginAsAdmin(page);

  // 1. Cliente E2E → aba Locais → novo local
  await page.goto('/app/clientes/e2e-client');
  await page.getByRole('button', { name: 'Locais' }).click();
  await page.getByRole('button', { name: 'Novo local' }).click();
  await page.locator('#l-name').fill(local);
  await page.getByRole('button', { name: 'Criar local' }).click();
  await expect(page.getByText('Local criado.')).toBeVisible();
  await expect(page.getByRole('cell', { name: local })).toBeVisible();

  // 2. Cliente E2E → aba Contratos → novo contrato cobrindo esse local
  await page.getByRole('button', { name: 'Contratos' }).click();
  await page.getByRole('button', { name: 'Novo contrato' }).click();
  await page.waitForURL(/\/app\/contratos\/novo/);
  await page.locator('#name').fill(nomeContrato);
  const hoje = new Date().toISOString().slice(0, 10);
  const proximoAno = new Date(Date.now() + 365 * 24 * 3600_000).toISOString().slice(0, 10);
  await page.locator('input[type="date"]').nth(0).fill(hoje);
  await page.locator('input[type="date"]').nth(1).fill(proximoAno);
  await page.getByRole('button', { name: 'Criar contrato' }).click();
  await page.waitForURL(/\/app\/contratos\/(?!novo)[^/]+$/);

  // 3. Ficha do contrato → marca o local no escopo → salva
  await page.getByText(local).click();
  await page.getByRole('button', { name: 'Salvar escopo' }).click();
  await expect(page.getByText('Escopo atualizado.')).toBeVisible();

  // 4. Novo chamado nesse local → detalhe mostra o contrato vinculado
  await page.goto('/app/chamados/novo');
  await page.locator('select').nth(0).selectOption({ label: 'Cliente E2E' });
  await page.locator('select').nth(1).selectOption({ index: 1 });
  await page.locator('#title').fill(titulo);
  await page.locator('#desc').fill('Chamado gerado pelo smoke E2E de contrato.');
  await page.locator('select').nth(4).selectOption({ label: local });
  await page.getByRole('button', { name: 'Criar chamado' }).click();
  await page.waitForURL(/\/app\/chamados\/(?!novo)[^/]+$/);
  await expect(page.getByRole('link', { name: nomeContrato })).toBeVisible();
});
