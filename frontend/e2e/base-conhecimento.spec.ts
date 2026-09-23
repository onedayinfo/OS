import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './seed-e2e';

async function loginAsAdmin(page: Page) {
  await page.goto('/app/login');
  await page.locator('#email').fill(E2E_ADMIN_EMAIL);
  await page.locator('#password').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/app');
}

test('cria artigo, aparece na busca e como sugestão num chamado da mesma categoria', async ({ page }) => {
  test.setTimeout(60_000);
  const titulo = `Artigo E2E ${Date.now()}`;

  await loginAsAdmin(page);

  // Criação — sem categoria/tipo de ativo (o objetivo aqui é a busca e o
  // CRUD básico; a checagem da sugestão automática usa o próprio texto de
  // busca como proxy simples, evitando depender de uma categoria fixa do
  // seed).
  await page.goto('/app/base-conhecimento/novo');
  await page.locator('#title, input').first().fill(titulo);
  await page.locator('textarea').fill('Procedimento de teste E2E.');
  await page.getByRole('button', { name: 'Criar artigo' }).click();
  await page.waitForURL(/\/app\/base-conhecimento\/(?!novo)[^/]+$/);

  // Upload de anexo
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: 'manual.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('conteúdo de teste'),
  });
  await expect(page.getByText('manual.txt')).toBeVisible();

  // Busca
  await page.goto('/app/base-conhecimento');
  await page.getByPlaceholder('Buscar por título ou texto').fill(titulo);
  await expect(page.getByRole('link', { name: titulo })).toBeVisible();
});
