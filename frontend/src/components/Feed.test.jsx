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
    expect(calls[1].url).toContain(`until_id=${first.id}`);
    expect(calls[1].url).toContain('max_results=20');
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
    localStorage.setItem('agora.token', 'token-de-teste');
    const p = makePost({ text: 'curta' });
    mockFetch([
      [/\/api\/auth\/me$/, { user: users.ana }],
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
});
