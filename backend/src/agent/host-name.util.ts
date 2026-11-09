const HOST_OK = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

/** Host público para o nome do MSI: PUBLIC_HOST > X-Forwarded-Host (1º valor) > Host. */
export function hostParaNome(forwardedHost?: string, host?: string): string | undefined {
  const bruto = process.env.PUBLIC_HOST || forwardedHost?.split(',')[0] || host;
  const h = bruto?.trim().toLowerCase().replace(/:\d+$/, '');
  if (!h || !HOST_OK.test(h)) return undefined;
  return h.includes('.') || h === 'localhost' ? h : undefined;
}
