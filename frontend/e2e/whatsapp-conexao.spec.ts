import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_CLIENT_ID } from './seed-e2e';

async function loginAsAdmin(page: Page) {
  await page.goto('/app/login');
  await page.locator('#email').fill(E2E_ADMIN_EMAIL);
  await page.locator('#password').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/app');
}

const steps = (webhook: 'ok' | 'error' | 'pending', connection: 'ok' | 'pending') => [
  { id: 'reachable', label: 'Evolution alcançável', status: 'ok' },
  { id: 'instance', label: 'Instância criada', status: 'ok', detail: 'Já existia' },
  { id: 'webhook', label: 'Webhook configurado', status: webhook, detail: webhook === 'ok' ? undefined : 'Clique em Conectar' },
  { id: 'connection', label: 'WhatsApp pareado', status: connection },
];
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('assistente de conexão e seletor de grupos da Evolution (com a API da Evolution simulada)', async ({ page }) => {
  test.setTimeout(90_000);
  const stamp = Date.now();
  const grupoLivre = { id: `${stamp}1@g.us`, name: `Suporte Livre ${stamp}`, size: 12, linkedClientId: null, linkedClientName: null };
  const grupoUsado = { id: `${stamp}2@g.us`, name: `Grupo Usado ${stamp}`, size: 4, linkedClientId: 'x', linkedClientName: 'Outro Cliente' };

  await page.route('**/api/whatsapp/setup', (route) =>
    route.fulfill({ json: { steps: steps('pending', 'pending'), state: 'close', qr: null, config: { urlFromEnv: true, apiKeyFromEnv: true, instance: 'os' } } }),
  );
  await page.route('**/api/whatsapp/connect', (route) =>
    route.fulfill({ json: { steps: steps('ok', 'pending'), state: 'close', qr: { base64: PNG, pairingCode: null }, config: { urlFromEnv: true, apiKeyFromEnv: true, instance: 'os' } } }),
  );
  await page.route('**/api/whatsapp/evolution/groups', (route) => route.fulfill({ json: [grupoLivre, grupoUsado] }));

  await loginAsAdmin(page);

  // 1. Configurações > WhatsApp: checklist e Conectar / Reparar
  await page.goto('/app/config');
  await page.getByRole('button', { name: 'WhatsApp' }).click();
  await expect(page.getByText('Evolution alcançável')).toBeVisible();
  await expect(page.getByText('Webhook configurado')).toBeVisible();
  await expect(page.getByText('Evolution configurada pelo ambiente da stack.')).toBeVisible();
  await page.getByRole('button', { name: 'Conectar / Reparar' }).click();
  await expect(page.getByAltText('QR code do WhatsApp')).toBeVisible();

  // 2. Ficha do cliente: escolher grupo da Evolution preenche o ID e o apelido
  await page.goto(`/app/clientes/${E2E_CLIENT_ID}`);
  await page.getByRole('button', { name: 'WhatsApp' }).click();
  await page.getByRole('button', { name: 'Escolher da Evolution' }).click();
  const dialog = page.getByRole('dialog', { name: 'Escolher grupo da Evolution' });
  await expect(dialog.getByText(grupoLivre.name)).toBeVisible();
  await expect(dialog.getByRole('button', { name: new RegExp(grupoUsado.name) })).toBeDisabled();
  await dialog.getByRole('button', { name: new RegExp(grupoLivre.name) }).click();
  await expect(page.locator('#wg-id')).toHaveValue(grupoLivre.id);
  await expect(page.locator('#wg-name')).toHaveValue(grupoLivre.name);
});
