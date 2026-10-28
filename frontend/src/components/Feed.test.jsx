import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext.jsx';
import { makePost, mockFetch, users } from '../test/fixtures.js';
import Feed from './Feed.jsx';

// Socket falso: os testes não abrem conexões reais.
vi.mock('../lib/socket.js', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn() }),
  closeSocket: vi.fn(),
}));

afterEach(() => localStorage.clear());

const page = (posts, nextToken, extraUsers = []) => ({
  data: posts,
  includes: { users: [users.ana, users.bruno, ...extraUsers], posts: [] },
  meta: { result_count: posts.length, ...(nextToken ? { next_token: nextToken } : {}) },
});

const renderFeed = (props) =>
  render(
    <MemoryRouter>
      <AuthProvider>
        <Feed endpoint="/api/posts" {...props} />
      </AuthProvider>
    </MemoryRouter>,
  );

describe('<Feed>', () => {
  it('renderiza posts com autor, timestamp relativo e ações', async () => {
    mockFetch([[/\/api\/posts/, page([makePost({ text: 'primeiro post' })])]]);
    renderFeed();
    expect(await screen.findByText('primeiro post')).toBeInTheDocument();
    expect(screen.getByText('Ana Souza')).toBeInTheDocument();
    expect(screen.getByText('@ana_dev')).toBeInTheDocument();
    expect(screen.getByText('agora')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Curtir' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Responder' })).toBeInTheDocument();
  });

  it('pagina por cursor: a próxima página usa until_id = next_token', async () => {
    const first = makePost({ text: 'mais novo' });
    const second = makePost({ text: 'mais antigo' });
    const calls = mockFetch([
      [/until_id=/, page([second])],
      [/\/api\/posts/, page([first], first.id)],
    ]);
    renderFeed();
    await screen.findByText('mais novo');
    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('mais antigo')).toBeInTheDocument();
    const page2 = calls.find((c) => c.url.includes('until_id='));
    expect(page2.url).toContain(`until_id=${first.id}`);
    expect(page2.url).toContain('max_results=20');
    // última página (sem next_token) => sem botão
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });

  it('mostra o original e o cabeçalho de repost', async () => {
    const original = makePost({ text: 'texto original', author_id: '2' });
    const repost = makePost({ text: '', author_id: '1', referenced_posts: [{ type: 'reposted', id: original.id }] });
    mockFetch([[/\/api\/posts/, { ...page([repost]), includes: { users: [users.ana, users.bruno], posts: [original] } }]]);
    renderFeed();
    expect(await screen.findByText('texto original')).toBeInTheDocument();
    expect(screen.getByText(/Ana Souza repostou/)).toBeInTheDocument();
    expect(screen.getByText('Bruno Lima')).toBeInTheDocument();
  });

  it('exibe estado vazio', async () => {
    mockFetch([[/\/api\/posts/, page([])]]);
    renderFeed({ emptyText: 'Nada aqui' });
    expect(await screen.findByText('Nada aqui')).toBeInTheDocument();
  });

  it('curtir atualiza contador e estado a partir da resposta do servidor', async () => {
    const p = makePost({ text: 'curta' });
    mockFetch([
      [/\/api\/auth\/refresh$/, { token: 'token-de-teste', user: users.ana }],
      [/\/like$/, { data: { ...p, public_metrics: { ...p.public_metrics, like_count: 1 }, viewer: { liked: true, reposted: false } }, includes: { users: [users.ana], posts: [] } }],
      [/\/api\/posts/, page([p])],
    ]);
    renderFeed();
    // O botão "Apagar" só aparece no post do próprio usuário => sessão carregada.
    await screen.findByRole('button', { name: 'Apagar' });
    await userEvent.click(screen.getByRole('button', { name: 'Curtir' }));
    const btn = await screen.findByRole('button', { name: 'Descurtir' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toHaveTextContent('1');
  });

  it('feed de interesses: cursor next_token, sem rolagem automática e com fim explícito', async () => {
    const a = makePost({ text: 'primeiro do ranking' });
    const b = makePost({ text: 'segundo do ranking' });
    const calls = mockFetch([
      [/next_token=1/, { ...page([b]), meta: { result_count: 1, caught_up: true, session: { delivered: 2 } } }],
      [/\/api\/feed\/interesses/, { ...page([a]), meta: { result_count: 1, next_token: '1', caught_up: false } }],
    ]);
    renderFeed({
      endpoint: '/api/feed/interesses',
      cursorParam: 'next_token',
      autoLoad: false,
      renderEnd: (meta) => <p>Você está em dia ({meta.session.delivered})</p>,
    });
    await screen.findByText('primeiro do ranking');
    expect(screen.queryByText(/Você está em dia/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Você está em dia (2)')).toBeInTheDocument();
    const page2 = calls.find((c) => c.url.includes('next_token='));
    expect(page2.url).toContain('next_token=1');
    expect(page2.url).not.toContain('until_id');
  });

  it('recompensar: transfere 1 token e mostra o erro de saldo com atalho para as missões', async () => {
    const p = makePost({ text: 'post do bruno', author_id: '2' });
    const p2 = makePost({ text: 'outro do bruno', author_id: '2' });
    mockFetch([
      [/\/api\/auth\/refresh$/, { token: 'token-de-teste', user: users.ana }],
      [/\/api\/token$/, { name: 'NewCoin', symbol: 'NWC', tip_amount: 1 }],
      [new RegExp(`/api/posts/${p.id}/recompensa$`), { data: { ...p, public_metrics: { ...p.public_metrics, tip_count: 1 }, viewer: { liked: false, reposted: false, tipped: true } }, includes: { users: [users.bruno], posts: [] } }],
      [/\/api\/posts\?/, page([p, p2])],
    ]);
    // o segundo post responde com saldo insuficiente
    const original = fetch;
    globalThis.fetch = vi.fn(async (url, init) =>
      url === `/api/posts/${p2.id}/recompensa`
        ? { ok: false, status: 409, json: async () => ({ error: 'Saldo insuficiente de NWC. Conclua missões para ganhar mais.' }) }
        : original(url, init),
    );
    renderFeed();
    await screen.findByText('post do bruno');
    const [first, second] = await screen.findAllByRole('button', { name: /Recompensar com 1 NWC/ });
    await userEvent.click(first);
    const done = await screen.findByRole('button', { name: 'Você recompensou com 1 NWC' });
    expect(done).toHaveAttribute('aria-pressed', 'true');
    expect(done).toHaveTextContent('1');
    await userEvent.click(second);
    expect(await screen.findByRole('alert')).toHaveTextContent('Saldo insuficiente de NWC');
    expect(screen.getByRole('link', { name: 'Ver missões' })).toHaveAttribute('href', '/missoes');
  });
});
