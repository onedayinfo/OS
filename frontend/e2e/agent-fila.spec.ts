import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_ASSET_TYPE, E2E_CLIENT_ID } from './seed-e2e';

// API do backend (mesma base do NEXT_PUBLIC_API_URL do frontend).
const API = process.env.E2E_API_URL ?? 'http://localhost:3001/api';

async function loginAsAdmin(page: Page) {
  await page.goto('/app/login');
  await page.locator('#email').fill(E2E_ADMIN_EMAIL);
  await page.locator('#password').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/app');
}

test('ADMIN aprova na fila um PC inscrito pelo agente e o ativo aparece em /app/ativos', async ({ page, request }) => {
  test.setTimeout(90_000);
  const stamp = Date.now();
  const local = `Local Agente E2E ${stamp}`;
  const hostname = `PC-E2E-${stamp}`;
  const nome = `Computador E2E ${stamp}`;

  // Seed via API: login → local + contrato ativo → código de instalação → enroll do PC.
  const login = await request.post(`${API}/auth/login`, {
    data: { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD },
  });
  expect(login.ok()).toBeTruthy();
  const auth = { Authorization: `Bearer ${(await login.json()).accessToken}` };

  const loc = await request.post(`${API}/locations`, { headers: auth, data: { clientId: E2E_CLIENT_ID, name: local } });
  expect(loc.ok()).toBeTruthy();

  const day = 24 * 3600_000;
  const contrato = await request.post(`${API}/contracts`, {
    headers: auth,
    data: {
      clientId: E2E_CLIENT_ID,
      name: `Contrato Agente E2E ${stamp}`,
      startDate: new Date(Date.now() - day).toISOString(),
      endDate: new Date(Date.now() + 365 * day).toISOString(),
      franchiseUnit: 'VISITS',
      franchiseAmount: 1,
    },
  });
  expect(contrato.ok()).toBeTruthy();

  const code = await request.post(`${API}/clients/${E2E_CLIENT_ID}/agent/code`, { headers: auth });
  expect(code.ok()).toBeTruthy();
  const enroll = await request.post(`${API}/agent/enroll`, {
    data: {
      code: (await code.json()).code,
      machineGuid: `guid-e2e-${stamp}`,
      hostname,
      serialNumber: `SN-E2E-${stamp}`,
      manufacturer: 'Dell',
      model: 'OptiPlex E2E',
      ip: '10.0.0.9',
      agentVersion: '1.0.0',
    },
  });
  expect(enroll.ok()).toBeTruthy();

  // UI: aprova na fila escolhendo o local.
  await loginAsAdmin(page);
  await page.goto(`/app/ativos/fila?clientId=${E2E_CLIENT_ID}`);
  const linha = page.getByRole('row', { name: new RegExp(hostname) });
  await expect(linha).toBeVisible();
  await linha.getByRole('button', { name: 'Aprovar' }).click();

  const dialog = page.getByRole('dialog', { name: `Aprovar ${hostname}` });
  await dialog.locator('#ap-location').selectOption({ label: local });
  await dialog.locator('#ap-type').selectOption({ label: E2E_ASSET_TYPE });
  await dialog.locator('#ap-label').fill(nome);
  await dialog.getByRole('button', { name: 'Aprovar e criar ativo' }).click();
  await expect(linha).toHaveCount(0);

  // O ativo criado aparece na lista de ativos com o nome informado.
  await page.goto('/app/ativos');
  await expect(page.getByRole('link', { name: nome })).toBeVisible();
});
