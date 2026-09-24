import { expect, test, type Page } from '@playwright/test';
import {
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD,
  E2E_AGENT_EMAIL,
  E2E_AGENT_PASSWORD,
} from './seed-e2e';

async function login(page: Page, email: string, password: string) {
  await page.goto('/app/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/app');
}

test('agenda uma visita e o técnico executa até fechar', async ({ page }) => {
  test.setTimeout(120_000);
  const titulo = `Chamado visita E2E ${Date.now()}`;

  // 1. ADMIN abre um chamado e agenda uma visita pro Agente E2E, hoje.
  await login(page, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Novo chamado' }).click();
  const novoChamado = page.getByRole('dialog', { name: 'Novo chamado' });
  await novoChamado.locator('select').nth(0).selectOption({ label: 'Cliente E2E' });
  await novoChamado.locator('select').nth(1).selectOption({ index: 1 });
  await novoChamado.locator('#title').fill(titulo);
  await novoChamado.locator('#desc').fill('Chamado gerado pelo smoke E2E de visita.');
  await novoChamado.getByRole('button', { name: 'Criar chamado' }).click();
  await page.waitForURL(/\/app\/chamados\/(?!novo)[^/]+$/);
  const ticketNumber = (await page.locator('p.font-mono').first().textContent())?.trim();

  await page.goto('/app/agenda');
  await page.getByRole('button', { name: 'Agendar visita' }).click();
  const ticketSelect = page.locator('select').first();
  const ticketOptionValue = await ticketSelect
    .locator('option', { hasText: titulo })
    .first()
    .getAttribute('value');
  await ticketSelect.selectOption(ticketOptionValue!);
  await page.locator('select').nth(1).selectOption({ label: 'Agente E2E' });
  const hoje = new Date().toISOString().slice(0, 10);
  await page.locator('input[type="date"]').first().fill(hoje);
  await page.getByRole('button', { name: 'Agendar visita' }).click();
  await expect(page.getByRole('link', { name: `#${ticketNumber}` })).toBeVisible();

  // 2. Agente loga, vai em Campo, faz check-in, checklist, assinatura, check-out e fecha.
  await login(page, E2E_AGENT_EMAIL, E2E_AGENT_PASSWORD);
  await page.goto('/app/campo');
  await page.getByText(`#${ticketNumber}`, { exact: false }).click();
  await page.getByRole('button', { name: 'Check-in' }).click();
  await expect(page.getByRole('button', { name: 'Check-in' })).toHaveCount(0);

  for (const checkbox of await page.getByRole('checkbox').all()) {
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Salvar checklist' }).click();

  const canvas = page.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const opts = (x: number, y: number) => ({
    clientX: box.x + x,
    clientY: box.y + y,
    pointerId: 1,
    button: 0,
    buttons: 1,
  });
  await canvas.dispatchEvent('pointerdown', opts(20, 20));
  await canvas.dispatchEvent('pointermove', opts(60, 50));
  await canvas.dispatchEvent('pointermove', opts(100, 80));
  await canvas.dispatchEvent('pointerup', opts(100, 80));
  await page.getByRole('button', { name: 'Confirmar assinatura' }).click();
  await expect(page.getByText('Assinatura registrada.')).toBeVisible();

  await page.getByRole('button', { name: 'Check-out' }).click();
  await page.getByRole('button', { name: 'Fechar visita' }).click();
  await page.waitForURL('**/app/campo');
});
