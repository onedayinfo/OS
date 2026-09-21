import { expect, test } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './seed-e2e.js';

test('dashboard de gestão carrega os cards e as tabelas sem erro', async ({ page }) => {
  await page.goto('/app/login');
  await page.locator('#email').fill(E2E_ADMIN_EMAIL);
  await page.locator('#password').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/app');

  await page.goto('/app/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Chamados abertos')).toBeVisible();
  await expect(page.getByText('Chamados vencidos')).toBeVisible();
  await expect(page.getByText('Produtividade por técnico')).toBeVisible();
  await expect(page.getByText('Contratos com franquia estourada')).toBeVisible();
});
