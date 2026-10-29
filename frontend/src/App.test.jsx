import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import { makePost, mockFetch, users } from './test/fixtures.js';

vi.mock('./lib/socket.js', () => ({ getSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), emitWithAck: vi.fn(), connected: true }), closeSocket: vi.fn() }));
Element.prototype.scrollIntoView = vi.fn();

// Visitante lê; interagir pede login (e depois do login volta para a página de origem).

const post = makePost({ id: '501', text: 'post aberto para leitura' });
const feed = { data: [post], includes: { users: [users.bruno], posts: [] }, meta: { result_count: 1, newest_id: '501', oldest_id: '501' } };
const readOnly = (loggedIn) => [
  [/\/api\/auth\/refresh$/, (_u, _i) => (loggedIn ? { token: 't', user: users.ana } : null)],
  [/\/api\/token$/, { name: 'NewCoin', symbol: 'NWC', tip_amount: 1 }],
  [/\/api\/posts\/501\/thread/, { ...feed, meta: { conversation_id: '501', focal_id: '501', result_count: 1 } }],
  [/\/api\/posts\?/, feed],
  [/\/api\/users\/bruno$/, { data: { ...users.bruno, public_metrics: { followers_count: 1, following_count: 0, post_count: 1 }, relationship: null } }],
  [/\/api\/users\/bruno\/posts/, feed],
];

function renderAt(path) {
  mockFetch(readOnly(false));
  // Sem sessão: o refresh devolve 401.
  const f = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url, init) => (String(url).endsWith('/api/auth/refresh') ? { ok: false, status: 401, json: async () => ({ error: 'Sessão inválida' }) } : f(url, init)));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('visitante (sem conta)', () => {
  it('lê a timeline sem ser mandado para o login, com a faixa que explica o que falta', async () => {
    renderAt('/');
    expect(await screen.findByText('post aberto para leitura')).toBeInTheDocument();
    expect(screen.getByText(/Você está só lendo/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Novo post' })).not.toBeInTheDocument();
  });

  it('curtir pede login (não curte nada) e leva para entrar', async () => {
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Curtir' }));
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/Entre para interagir/);
    expect(globalThis.fetch.mock.calls.some(([u, i]) => /\/like$/.test(u) && i?.method === 'POST')).toBe(false);
  });

  it('na thread, lê as respostas, mas o campo de resposta vira um convite para entrar', async () => {
    renderAt('/post/501');
    expect(await screen.findByText('Você pode ler esta conversa. Para responder, entre na sua conta.')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Responder a/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entrar para responder' })).toBeInTheDocument();
  });

  it('no perfil, vê os posts, mas "Seguir" pede login e não aparece menu de silenciar, bloquear ou denunciar', async () => {
    renderAt('/u/bruno');
    expect(await screen.findByText('post aberto para leitura')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Denunciar|Silenciar|Bloquear/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Seguir' }));
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('páginas que exigem conta (carteira, canais, moderação) levam de volta ao início, sem mostrar nada delas', async () => {
    renderAt('/carteira');
    expect(await screen.findByText('post aberto para leitura')).toBeInTheDocument();
  });

  it('depois de entrar, volta para o post de onde veio e já pode responder', async () => {
    renderAt('/post/501');
    const base = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, init) =>
      String(url).endsWith('/api/auth/login') ? { ok: true, status: 200, json: async () => ({ token: 't', user: users.ana }) } : base(url, init),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Entrar para responder' }));
    await userEvent.type(await screen.findByLabelText('E-mail'), 'ana@exemplo.test');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha1234');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByPlaceholderText(/Responder a/)).toBeInTheDocument();
    expect(screen.queryByText(/Você está só lendo/)).not.toBeInTheDocument();
  });
});

