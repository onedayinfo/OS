import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './seed-e2e';

async function loginAsAdmin(page: Page) {
  await page.goto('/app/login');
  await page.locator('#email').fill(E2E_ADMIN_EMAIL);
  await page.locator('#password').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/app');
}

async function slaText(page: Page): Promise<string> {
  const value = page.getByText('SLA', { exact: true }).locator('xpath=following-sibling::span[1]');
  return (await value.textContent())?.trim() ?? '';
}

test('pausar em Aguardando cliente e voltar empurra o prazo de SLA pra frente', async ({ page }) => {
  test.setTimeout(60_000);
  const titulo = `Chamado SLA pausa E2E ${Date.now()}`;

  await loginAsAdmin(page);

  await page.goto('/app/chamados/novo');
  await page.locator('select').nth(0).selectOption({ label: 'Cliente E2E' });
  await page.locator('select').nth(1).selectOption({ index: 1 });
  await page.locator('#title').fill(titulo);
  await page.locator('#desc').fill('Descrição de teste E2E.');
  await page.getByRole('button', { name: 'Criar chamado' }).click();
  await page.waitForURL(/\/app\/chamados\/(?!novo)[^/]+$/);

  const before = await slaText(page);
  expect(before).not.toBe('—');

  await page.getByLabel('Status').selectOption('WAITING_CLIENT');
  await page.waitForTimeout(1500);
  await page.getByLabel('Status').selectOption('IN_PROGRESS');
  await page.reload();

  const after = await slaText(page);
  expect(after).not.toBe(before);
});
