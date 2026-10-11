import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service.js';

export const DEFAULT_INSTANCE = 'os';

export interface EvolutionConfig {
  url: string;
  apiKey: string;
  instance: string;
}

export interface EvolutionResponse {
  ok: boolean;
  status: number;
  body: unknown;
  error?: string;
}

/** Único ponto de acesso à Evolution API: configuração + HTTP que nunca lança. */
@Injectable()
export class EvolutionClient {
  constructor(private readonly settings: SettingsService) {}

  /** Ambiente da stack prevalece; sem ele vale o gravado na tela. Instância padrão "os". */
  async config(): Promise<EvolutionConfig | null> {
    const url = process.env.EVOLUTION_API_URL || (await this.settings.get('whatsapp.evolution.url'));
    const apiKey = process.env.EVOLUTION_API_KEY || (await this.settings.get('whatsapp.evolution.apiKey'));
    const instance = (await this.settings.get('whatsapp.evolution.instance')) || DEFAULT_INSTANCE;
    return url && apiKey ? { url: url.replace(/\/+$/, ''), apiKey, instance } : null;
  }

  async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    timeoutMs = 8000,
  ): Promise<EvolutionResponse> {
    const c = await this.config();
    if (!c) return { ok: false, status: 0, body: null, error: 'not_configured' };
    try {
      const res = await fetch(`${c.url}${path}`, {
        method,
        headers: { apikey: c.apiKey, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        /* corpo vazio ou não JSON */
      }
      return { ok: res.ok, status: res.status, body: parsed };
    } catch (e) {
      return { ok: false, status: 0, body: null, error: (e as Error).message };
    }
  }
}
