// Cliente HTTP mínimo.
//
// Sessão em duas peças (ver docs/10-seguranca-e-dos.md, A2):
//   - token de acesso: dura 15 min e fica SÓ na memória desta aba (não no localStorage,
//     onde um script injetado poderia copiá-lo e usá-lo por dias);
//   - refresh: fica num cookie HttpOnly que o JavaScript não lê. Ao abrir o app ou quando
//     o token de acesso vence, pedimos /api/auth/refresh e recebemos um token novo.
const LEGACY_TOKEN_KEY = 'agora.token';

let accessToken = null;
const listeners = new Set();

// Limpa o token de longa duração que versões antigas guardavam no navegador.
try {
  localStorage.removeItem(LEGACY_TOKEN_KEY);
} catch {
  /* armazenamento indisponível */
}

export const tokenStore = {
  get: () => accessToken,
  set: (t) => {
    accessToken = t ?? null;
    for (const fn of listeners) fn(accessToken);
  },
  /** Avisa quando o token muda (renovação automática ou saída). */
  subscribe: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export const OFFLINE_MESSAGE = 'Sem conexão com o servidor. Confira sua internet e tente de novo.';

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `Erro ${status}`);
    this.status = status;
    this.details = body?.details;
    this.body = body; // ex.: { suspension } no login de conta suspensa
  }
}

async function rawFetch(path, { method = 'GET', body, token }) {
  const headers = {};
  // Arquivo (imagem) vai como bytes, com o tipo dele; o resto vai como JSON.
  const isFile = typeof Blob !== 'undefined' && body instanceof Blob;
  if (body !== undefined) headers['Content-Type'] = isFile ? body.type || 'application/octet-stream' : 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : isFile ? body : JSON.stringify(body),
    });
  } catch {
    // O navegador só diz "Failed to fetch" (em inglês) quando não há rede ou o servidor não responde.
    throw new ApiError(0, { error: OFFLINE_MESSAGE });
  }
  const data = await res.json().catch(() => null);
  return { res, data };
}

// Vários pedidos podem descobrir ao mesmo tempo que o token venceu: renovamos uma vez só.
let refreshing = null;

/** Troca o cookie de sessão por um token de acesso novo. Devolve { token, user } ou null. */
export function refreshSession() {
  refreshing ??= rawFetch('/api/auth/refresh', { method: 'POST' })
    .then(({ res, data }) => {
      if (!res.ok || !data?.token) {
        tokenStore.set(null);
        return null;
      }
      tokenStore.set(data.token);
      return data;
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api(path, { method = 'GET', body, token = tokenStore.get() } = {}) {
  let { res, data } = await rawFetch(path, { method, body, token });
  // Token de acesso vencido: renova pela sessão e tenta de novo, uma vez.
  if (res.status === 401 && token && !path.startsWith('/api/auth/')) {
    const fresh = await refreshSession();
    if (fresh) ({ res, data } = await rawFetch(path, { method, body, token: fresh.token }));
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

/** Acrescenta parâmetros de query a um endpoint que pode já ter "?". */
export function withParams(endpoint, params) {
  const url = new URL(endpoint, 'http://x');
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  return url.pathname + url.search;
}
