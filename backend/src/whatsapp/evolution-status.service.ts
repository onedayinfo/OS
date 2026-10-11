import { Injectable } from '@nestjs/common';
import { EvolutionClient } from './evolution-client.js';

export interface WhatsappConnection {
  configured: boolean;
  state: string;
  disconnectedSince: string | null;
}

@Injectable()
export class EvolutionStatusService {
  // ponytail: instante da queda só em memória (reiniciar o backend zera). Persistir se virar auditoria.
  private disconnectedSince: Date | null = null;

  constructor(private readonly evo: EvolutionClient) {}

  async check(): Promise<WhatsappConnection> {
    const c = await this.evo.config();
    if (!c) return { configured: false, state: 'not_configured', disconnectedSince: null };

    let state = 'unreachable';
    const r = await this.evo.request('GET', `/instance/connectionState/${encodeURIComponent(c.instance)}`, undefined, 5000);
    if (r.ok) {
      const j = r.body as { instance?: { state?: string }; state?: string } | null;
      state = j?.instance?.state ?? j?.state ?? 'unknown';
    }
    if (state === 'open') this.disconnectedSince = null;
    else if (!this.disconnectedSince) this.disconnectedSince = new Date();
    return { configured: true, state, disconnectedSince: this.disconnectedSince?.toISOString() ?? null };
  }

  /** QR de pareamento (`GET /instance/connect/{instance}`). */
  async qr(): Promise<{ base64: string | null; pairingCode: string | null }> {
    const c = await this.evo.config();
    if (!c) return { base64: null, pairingCode: null };
    const r = await this.evo.request('GET', `/instance/connect/${encodeURIComponent(c.instance)}`, undefined, 10000);
    if (!r.ok) return { base64: null, pairingCode: null };
    const j = r.body as { base64?: string; pairingCode?: string } | null;
    return { base64: j?.base64 ?? null, pairingCode: j?.pairingCode ?? null };
  }
}
