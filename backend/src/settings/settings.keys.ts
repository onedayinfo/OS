export const SETTING_KEYS = [
  'resend.apiKey',
  'mail.from',
  'resend.inboundSecret',
  'storage.driver',
  'storage.path',
  'storage.s3.endpoint',
  'storage.s3.region',
  'storage.s3.bucket',
  'storage.s3.accessKeyId',
  'storage.s3.secretAccessKey',
  'storage.s3.forcePathStyle',
  'storage.s3.publicBaseUrl',
  'storage.s3.prefix',
  'backup.s3.enabled',
  'backup.retention',
  'branding.companyName',
  'branding.primaryColor',
  'branding.logoData',
  'branding.logoMime',
  'whatsapp.webhookSecret',
  'whatsapp.evolution.url',
  'whatsapp.evolution.apiKey',
  'whatsapp.evolution.instance',
  'whatsapp.retentionDays',
  'ai.anthropicApiKey',
  'ai.dailyTokenLimit',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

/** Chaves cujo valor é gravado criptografado (AES-256-GCM) e nunca devolvido cru. */
export const SECRET_KEYS: ReadonlySet<string> = new Set([
  'resend.apiKey',
  'resend.inboundSecret',
  'storage.s3.accessKeyId',
  'storage.s3.secretAccessKey',
  'whatsapp.webhookSecret',
  'whatsapp.evolution.apiKey',
  'ai.anthropicApiKey',
]);

/** Chave de config -> variável de ambiente legada (fallback durante a transição). */
export const ENV_FALLBACK: Readonly<Record<string, string>> = {
  'resend.apiKey': 'RESEND_API_KEY',
  'mail.from': 'MAIL_FROM',
  'resend.inboundSecret': 'RESEND_INBOUND_SECRET',
  'storage.path': 'STORAGE_PATH',
};

/** Chaves grandes que `describe()` nunca devolve cruas por peso (ex.: logo base64). */
export const BULKY_KEYS: ReadonlySet<string> = new Set(['branding.logoData']);
