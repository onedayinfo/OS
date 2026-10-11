import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service.js';

export interface WhatsappConnection {
  configured: boolean;
  state: string;
  disconnectedSince: string | null;
}

@Injectable()
export class EvolutionStatusService {
  // ponytail: instante da queda só em memória (reiniciar o backend zera). Persistir se virar auditoria.
  private disconnectedSince: Date | null = null;

  constructor(private readonly settings: SettingsService) {}

  private async cfg() {
    const [url, apiKey, instance] = await Promise.all([
      this.settings.get('whatsapp.evolution.url'),
      this.settings.get('whatsapp.evolution.apiKey'),
      this.settings.get('whatsapp.evolution.instance'),
    ]);
    return url && apiKey && instance ? { url: url.replace(/\/+$/, ''), apiKey, instance } : null;
  }

  async check(): Promise<WhatsappConnection> {
    const c = await this.cfg();
    if (!c) return { configured: false, state: 'not_configured', disconnectedSince: null };

    let state = 'unreachable';
    try {
      const res = await fetch(`${c.url}/instance/connectionState/${encodeURIComponent(c.instance)}`, {
        headers: { apikey: c.apiKey },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const j = (await res.json()) as { instance?: { state?: string }; state?: string };
        state = j?.instance?.state ?? j?.state ?? 'unknown';
      }
    } catch {
      /* inalcançável */
    }
    if (state === 'open') this.disconnectedSince = null;
    else if (!this.disconnectedSince) this.disconnectedSince = new Date();
    return { configured: true, state, disconnectedSince: this.disconnectedSince?.toISOString() ?? null };
  }

  /** QR de pareamento (formato da resposta de `GET /instance/connect/{instance}` — conferir na Task 20). */
  async qr(): Promise<{ base64: string | null; pairingCode: string | null }> {
    const c = await this.cfg();
    if (!c) return { base64: null, pairingCode: null };
    try {
      const res = await fetch(`${c.url}/instance/connect/${encodeURIComponent(c.instance)}`, {
        headers: { apikey: c.apiKey },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { base64: null, pairingCode: null };
      const j = (await res.json()) as { base64?: string; pairingCode?: string };
      return { base64: j.base64 ?? null, pairingCode: j.pairingCode ?? null };
    } catch {
      return { base64: null, pairingCode: null };
    }
  }
}
