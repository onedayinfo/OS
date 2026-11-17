import { expect, test } from '@playwright/test';
import { E2E_RESTRICTED_EMAIL, E2E_RESTRICTED_PASSWORD } from './seed-e2e';

test('ADMIN de grupo sem CRM: menu, redirecionamento, chamado e config', async ({ page }) => {
  await page.goto('/app/login');
  await page.locator('#email').fill(E2E_RESTRICTED_EMAIL);
  await page.locator('#password').fill(E2E_RESTRICTED_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/app');

  // menu sem CRM, com Clientes
  await expect(page.getByRole('link', { name: 'Clientes' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'CRM' })).toHaveCount(0);

  // tela proibida redireciona para /app com aviso
  for (const rota of ['/app/crm', '/app/crm/qualquer-id']) {
    await page.goto(rota);
    await page.waitForURL(/\/app$/);
    await expect(page.getByText('Sem acesso a esta tela.')).toBeVisible();
  }

  // novo chamado lista os clientes do seed
  await page.getByRole('button', { name: 'Novo chamado' }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo chamado' });
  await expect(dialog.locator('select').nth(0).locator('option', { hasText: 'Cliente E2E' })).toHaveCount(1);
  await page.keyboard.press('Escape');

  // Configurações sem a aba Grupos
  await page.goto('/app/config');
  await expect(page.getByRole('button', { name: 'Usuários internos', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Grupos', exact: true })).toHaveCount(0);
});
