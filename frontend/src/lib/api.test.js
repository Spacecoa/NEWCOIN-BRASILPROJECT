import { beforeEach, describe, expect, it, vi } from 'vitest';

// Cada teste carrega o módulo do zero (o token vive na memória do módulo).
async function load() {
  vi.resetModules();
  return import('./api.js');
}

function fakeServer(handler) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      calls.push({ url, init, auth: init.headers?.Authorization });
      const [status, body] = handler(url, init, calls);
      return { ok: status < 400, status, json: async () => body };
    }),
  );
  return calls;
}

describe('sessão no navegador', () => {
  beforeEach(() => localStorage.clear());

  it('apaga o token antigo de 7 dias do localStorage e nunca grava o novo lá', async () => {
    localStorage.setItem('agora.token', 'token-velho');
    const { tokenStore } = await load();
    expect(localStorage.getItem('agora.token')).toBeNull();
    tokenStore.set('novo');
    expect(tokenStore.get()).toBe('novo');
    expect(Object.keys(localStorage)).toHaveLength(0);
  });

  it('token vencido: renova pela sessão uma vez e repete o pedido', async () => {
    const { api, tokenStore } = await load();
    tokenStore.set('vencido');
    const calls = fakeServer((url, init) => {
      if (url === '/api/auth/refresh') return [200, { token: 'fresco', user: { id: '1' } }];
      return init.headers?.Authorization === 'Bearer fresco' ? [200, { data: 'ok' }] : [401, { error: 'Não autenticado' }];
    });
    expect(await api('/api/timeline')).toEqual({ data: 'ok' });
    expect(calls.map((c) => c.url)).toEqual(['/api/timeline', '/api/auth/refresh', '/api/timeline']);
    expect(calls[1].init.credentials).toBe('same-origin');
    expect(tokenStore.get()).toBe('fresco');
  });

  it('vários pedidos ao mesmo tempo disparam uma renovação só', async () => {
    const { api, tokenStore } = await load();
    tokenStore.set('vencido');
    const calls = fakeServer((url, init) => {
      if (url === '/api/auth/refresh') return [200, { token: 'fresco', user: { id: '1' } }];
      return init.headers?.Authorization === 'Bearer fresco' ? [200, {}] : [401, {}];
    });
    await Promise.all([api('/api/a'), api('/api/b'), api('/api/c')]);
    expect(calls.filter((c) => c.url === '/api/auth/refresh')).toHaveLength(1);
  });

  it('sessão encerrada em outro lugar: limpa o token e avisa quem escuta', async () => {
    const { api, tokenStore, ApiError } = await load();
    tokenStore.set('vencido');
    const seen = [];
    tokenStore.subscribe((t) => seen.push(t));
    fakeServer(() => [401, { error: 'Sessão encerrada' }]);
    await expect(api('/api/timeline')).rejects.toBeInstanceOf(ApiError);
    expect(tokenStore.get()).toBeNull();
    expect(seen).toEqual([null]);
  });

  it('erro de login não tenta renovar', async () => {
    const { api } = await load();
    const calls = fakeServer(() => [401, { error: 'Credenciais inválidas' }]);
    await expect(api('/api/auth/login', { method: 'POST', body: {} })).rejects.toThrow('Credenciais inválidas');
    expect(calls).toHaveLength(1);
  });
});
