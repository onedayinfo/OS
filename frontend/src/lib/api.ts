// Cliente HTTP do frontend: injeta o access token, faz refresh single-flight em
// 401 e repete a request original uma vez. Sem dependência externa.

// Sem NEXT_PUBLIC_API_URL a imagem cai em `/api` relativo — funciona quando o
// front e a API estão no mesmo domínio (o proxy roteia /api → backend). Para
// domínios separados, defina NEXT_PUBLIC_API_URL em build time.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';
const TOKEN_KEY = 'os.accessToken';

let accessToken: string | null = null;
let hydrated = false;

function hydrateToken(): string | null {
  if (!hydrated) {
    hydrated = true;
    try {
      accessToken = localStorage.getItem(TOKEN_KEY);
    } catch {
      // localStorage indisponível (SSR/modo restrito) — segue só com memória.
    }
  }
  return accessToken;
}

export function getAccessToken(): string | null {
  return hydrateToken();
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  hydrated = true;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // idem
  }
}

// Callback disparado quando o refresh falha (sessão expirada de verdade).
let sessionExpiredHandler: (() => void) | null = null;
export function setSessionExpiredHandler(fn: (() => void) | null): void {
  sessionExpiredHandler = fn;
}

export class ApiError extends Error {
  readonly status: number;
  readonly data: unknown;
  constructor(status: number, data: unknown) {
    const msg =
      data && typeof data === 'object' && 'message' in data
        ? String((data as { message: unknown }).message)
        : `HTTP ${status}`;
    super(msg);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') ?? '';
  if (res.status === 204) return undefined;
  try {
    return ct.includes('application/json') ? await res.json() : await res.text();
  } catch {
    return undefined;
  }
}

// Uma única Promise de refresh compartilhada entre chamadas concorrentes.
let refreshInFlight: Promise<string> | null = null;

function refreshAccessToken(): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) throw new ApiError(res.status, await parseBody(res));
        const data = (await res.json()) as { accessToken: string };
        setAccessToken(data.accessToken);
        return data.accessToken;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

// Igual ao RequestInit padrão, mas `body` aceita também objeto/array puro (vira
// JSON automaticamente).
export type ApiInit = Omit<RequestInit, 'body'> & { body?: BodyInit | object | null };

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const send = (token: string | null): Promise<Response> => {
    const headers = new Headers(init.headers);
    const { body: rawBody, ...rest } = init;
    let body = rawBody as BodyInit | null | undefined;
    if (
      rawBody != null &&
      typeof rawBody === 'object' &&
      !(rawBody instanceof FormData) &&
      !(rawBody instanceof URLSearchParams) &&
      !(rawBody instanceof Blob) &&
      !(rawBody instanceof ArrayBuffer)
    ) {
      body = JSON.stringify(rawBody);
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    }
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(`${API_BASE}${path}`, { ...rest, body, headers, credentials: 'include' });
  };

  let res = await send(getAccessToken());

  if (res.status === 401) {
    try {
      const fresh = await refreshAccessToken();
      res = await send(fresh);
    } catch {
      setAccessToken(null);
      sessionExpiredHandler?.();
      throw new ApiError(401, { message: 'Sessão expirada.' });
    }
  }

  const parsed = await parseBody(res);
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed as T;
}
