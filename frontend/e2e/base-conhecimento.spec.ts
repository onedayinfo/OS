import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/index.js';
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

  // Categoria ativa já existente no seed E2E (globalSetup garante ao menos
  // uma) — usada pra vincular o artigo e o chamado à mesma categoria, sem
  // depender de qual categoria específica o seed criou.
  const prisma = new PrismaClient();
  const categoria = await prisma.category.findFirst({ where: { active: true } });
  await prisma.$disconnect();
  if (!categoria) throw new Error('Nenhuma categoria ativa no seed E2E.');

  await loginAsAdmin(page);

  // Criação do artigo, já vinculado à categoria.
  await page.goto('/app/base-conhecimento');
  await page.getByRole('button', { name: 'Novo artigo' }).click();
  const novoArtigo = page.getByRole('dialog', { name: 'Novo artigo' });
  await novoArtigo.locator('#title, input').first().fill(titulo);
  await novoArtigo.locator('textarea').fill('Procedimento de teste E2E.');
  await novoArtigo.locator('select').first().selectOption({ label: categoria.name });
  await novoArtigo.getByRole('button', { name: 'Criar artigo' }).click();
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

  // Sugestão automática: abre um chamado da mesma categoria e confere que o
  // artigo aparece em "Artigos relacionados", com link pra ficha do artigo.
  await page.goto('/app');
  await page.getByRole('button', { name: 'Novo chamado' }).click();
  const novoChamado = page.getByRole('dialog', { name: 'Novo chamado' });
  await novoChamado.locator('select').nth(0).selectOption({ label: 'Cliente E2E' });
  await novoChamado.locator('select').nth(1).selectOption({ index: 1 }); // solicitante (único contato)
  await novoChamado.locator('#title').fill(`Chamado E2E ${Date.now()}`);
  await novoChamado.locator('#desc').fill('Descrição de teste E2E.');
  await novoChamado.locator('select').nth(2).selectOption({ label: categoria.name }); // categoria
  await novoChamado.getByRole('button', { name: 'Criar chamado' }).click();
  await page.waitForURL(/\/app\/chamados\/(?!novo)[^/]+$/);

  await expect(page.getByText('Artigos relacionados')).toBeVisible();
  const suggestionLink = page.getByRole('link', { name: titulo });
  await expect(suggestionLink).toBeVisible();
  await suggestionLink.click();
  await expect(page).toHaveURL(/\/app\/base-conhecimento\/[^/]+$/);
  await expect(page.locator('input').first()).toHaveValue(titulo);
});
