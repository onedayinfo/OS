import { SECRET_KEYS, SETTING_KEYS } from './settings.keys.js';

describe('chaves do WhatsApp/IA', () => {
  it('registra todas as chaves novas', () => {
    for (const k of [
      'whatsapp.webhookSecret',
      'whatsapp.evolution.url',
      'whatsapp.evolution.apiKey',
      'whatsapp.evolution.instance',
      'whatsapp.retentionDays',
      'ai.anthropicApiKey',
      'ai.dailyTokenLimit',
    ]) {
      expect(SETTING_KEYS).toContain(k);
    }
  });

  it('marca como segredo o que não pode voltar cru', () => {
    for (const k of ['whatsapp.webhookSecret', 'whatsapp.evolution.apiKey', 'ai.anthropicApiKey']) {
      expect(SECRET_KEYS.has(k)).toBe(true);
    }
    expect(SECRET_KEYS.has('whatsapp.evolution.url')).toBe(false);
  });
});
