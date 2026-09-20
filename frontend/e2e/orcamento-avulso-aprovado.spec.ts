import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './seed-e2e.js';

async function loginAsAdmin(page: Page) {
  await page.goto('/app/login');
  await page.locator('#email').fill(E2E_ADMIN_EMAIL);
  await page.locator('#password').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/app');
}

test('orçamento avulso aprovado pelo link público vira chamado', async ({ page, context }) => {
  test.setTimeout(90_000);
  const stamp = Date.now();
  const itemNome = `Instalação E2E ${stamp}`;
  const tituloChamado = `Instalação nova E2E ${stamp}`;

  await loginAsAdmin(page);

  // Cadastro mínimo: item de catálogo (serviço)
  await page.goto('/app/catalogo');
  await page.getByPlaceholder('Nome').fill(itemNome);
  await page.getByPlaceholder('Unidade').fill('un');
  await page.getByPlaceholder('Preço').fill('500');
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await expect(page.getByText(itemNome)).toBeVisible();

  // Orçamento avulso
  await page.goto('/app/orcamentos/novo');
  await page.getByLabel('Cliente').selectOption({ label: 'Cliente E2E' });
  await page.getByLabel('Categoria (chamado gerado na aprovação)').selectOption({ index: 1 });
  await page.getByLabel('Título do chamado').fill(tituloChamado);
  await page.locator('form select').nth(2).selectOption({ label: `${itemNome} — R$ 500.00/un` });
  await page.getByRole('button', { name: 'Criar orçamento' }).click();
  await page.waitForURL(/\/app\/orcamentos\/.+/);

  await page.getByRole('button', { name: 'Enviar' }).click();
  const publicLink = await page.getByRole('textbox').first().inputValue();
  expect(publicLink).toContain('/orcamento/');

  const publicPage = await context.newPage();
  await publicPage.goto(publicLink);
  await publicPage.getByRole('button', { name: 'Aprovar' }).click();
  await expect(publicPage.getByText('Orçamento aprovado')).toBeVisible();
  await publicPage.waitForLoadState('networkidle');
  await publicPage.close();

  await page.goto('/app');
  await expect(page.getByText(tituloChamado)).toBeVisible();
  await page.waitForLoadState('networkidle');
});
