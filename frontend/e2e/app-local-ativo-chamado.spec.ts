import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_ASSET_TYPE } from './seed-e2e';

// Smoke E2E: a equipe (ADMIN) cria um local, um ativo nesse local e um chamado
// vinculado ao local + ativo; o detalhe do chamado mostra o ativo na sidebar.
async function loginAsAdmin(page: Page) {
  await page.goto('/app/login');
  await page.locator('#email').fill(E2E_ADMIN_EMAIL);
  await page.locator('#password').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/app');
}

test('ADMIN cria local + ativo e abre chamado vinculado', async ({ page }) => {
  test.setTimeout(90_000); // servidor Next em produção "frio" + várias navegações
  const stamp = Date.now();
  const local = `Matriz ${stamp}`;
  const ativo = `CAM-E2E-${stamp}`;
  const titulo = `Chamado E2E ${stamp}`;

  await loginAsAdmin(page);

  // 1. Cliente E2E → aba Locais → novo local
  await page.goto('/app/clientes/e2e-client');
  await page.getByRole('button', { name: 'Locais' }).click();
  await page.getByRole('button', { name: 'Novo local' }).click();
  await page.locator('#l-name').fill(local);
  await page.getByRole('button', { name: 'Criar local' }).click();
  await expect(page.getByRole('cell', { name: local })).toBeVisible();

  // 2. /app/ativos → novo ativo (cliente, local, tipo, identificação)
  await page.goto('/app/ativos');
  await page.getByRole('button', { name: 'Novo ativo' }).click();
  await page.locator('#a-client').selectOption({ label: 'Cliente E2E' });
  await page.locator('#a-location').selectOption({ label: local });
  await page.locator('#a-type').selectOption({ label: E2E_ASSET_TYPE });
  await page.locator('#a-label').fill(ativo);
  await page.getByRole('button', { name: 'Criar ativo' }).click();
  await expect(page.getByRole('link', { name: ativo })).toBeVisible();

  // 3. Novo chamado → cliente + local + ativo
  await page.goto('/app');
  await page.getByRole('button', { name: 'Novo chamado' }).click();
  const novoChamado = page.getByRole('dialog', { name: 'Novo chamado' });
  // selects na ordem do form: 0 Cliente, 1 Solicitante, 2 Categoria, 3 Prioridade, 4 Local
  await novoChamado.locator('select').nth(0).selectOption({ label: 'Cliente E2E' });
  await novoChamado.locator('select').nth(1).selectOption({ index: 1 }); // solicitante (único contato)
  await novoChamado.locator('#title').fill(titulo);
  await novoChamado.locator('#desc').fill('Chamado gerado pelo smoke E2E.');
  await novoChamado.locator('select').nth(4).selectOption({ label: local });
  await novoChamado.getByRole('checkbox').check();
  await novoChamado.getByRole('button', { name: 'Criar chamado' }).click();

  // 4. Detalhe do chamado mostra o ativo na sidebar
  await page.waitForURL(/\/app\/chamados\/(?!novo)[^/]+$/);
  await expect(page.getByRole('heading', { name: titulo })).toBeVisible();
  await expect(page.getByText(ativo)).toBeVisible();
});
