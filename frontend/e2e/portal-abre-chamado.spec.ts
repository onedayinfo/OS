import { expect, test } from '@playwright/test';
import { E2E_EMAIL, E2E_PASSWORD } from './seed-e2e';

// Smoke E2E: um contato loga no portal, abre um chamado e o vê na lista.
test('contato abre um chamado pelo portal e ele aparece na lista', async ({ page }) => {
  const titulo = `E2E ${Date.now()}`;

  // 1. Login
  await page.goto('/portal/login');
  await page.locator('#email').fill(E2E_EMAIL);
  await page.locator('#password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();

  // 2. Cai na lista do portal
  await page.waitForURL('**/portal');
  await expect(page.getByRole('heading', { name: 'Meus chamados' })).toBeVisible();

  // 3. Abrir chamado
  await page.getByRole('button', { name: 'Abrir chamado' }).click();
  await page.waitForURL('**/portal/chamados/novo');
  await page.locator('#title').fill(titulo);
  await page.locator('#desc').fill('Chamado gerado pelo teste E2E.');
  await page.locator('select').first().selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Abrir chamado' }).click();

  // 4. Redireciona para o detalhe e mostra o título
  await page.waitForURL(/\/portal\/chamados\/(?!novo)[^/]+$/);
  await expect(page.getByRole('heading', { name: titulo })).toBeVisible();

  // 5. Volta para a lista e confirma o chamado
  await page.goto('/portal');
  await expect(page.getByRole('cell', { name: titulo })).toBeVisible();
});
