// Cliente HTTP mínimo. O token JWT fica no localStorage — simples para um protótipo
// local, mas vulnerável a XSS; em produção prefira cookie HttpOnly + SameSite.
const TOKEN_KEY = 'agora.token';

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t) => {
    try {
      t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* armazenamento indisponível: sessão vale só nesta aba */
    }
  },
};

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `Erro ${status}`);
    this.status = status;
    this.details = body?.details;
  }
}

export async function api(path, { method = 'GET', body, token = tokenStore.get() } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

/** Acrescenta parâmetros de query a um endpoint que pode já ter "?". */
export function withParams(endpoint, params) {
  const url = new URL(endpoint, 'http://x');
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  return url.pathname + url.search;
}
