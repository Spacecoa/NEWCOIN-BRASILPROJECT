import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { makePost, mockFetch, users } from '../test/fixtures.js';
import PostCard from './PostCard.jsx';

const auth = vi.hoisted(() => ({ user: { id: '1', username: 'ana_dev' } }));
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => auth }));
vi.mock('../lib/socket.js', () => ({ getSocket: () => ({ on: vi.fn(), off: vi.fn() }), closeSocket: vi.fn() }));

const renderCard = (post, extra = {}) => {
  const store = { users: { 1: users.ana, 2: users.bruno }, posts: { [post.id]: post, ...extra } };
  const onChange = vi.fn();
  render(<MemoryRouter><PostCard post={post} store={store} onChange={onChange} /></MemoryRouter>);
  return onChange;
};

describe('editar post', () => {
  it('a autora edita dentro do prazo: salva com PATCH e avisa que a versão anterior fica no histórico', async () => {
    const post = makePost({ id: '600', author_id: '1', text: 'Reunião às 18h', viewer: { liked: false, reposted: false, can_edit: true } });
    const calls = mockFetch([[/\/api\/posts\/600$/, { data: { ...post, text: 'Reunião às 19h', edit_count: 1 }, includes: { users: [] } }]]);
    const onChange = renderCard(post);
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    expect(screen.getByText('A versão anterior fica no histórico, aberta a quem lê.')).toBeInTheDocument();
    const box = screen.getByLabelText('Editar post');
    await userEvent.clear(box);
    await userEvent.type(box, 'Reunião às 19h');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar edição' }));
    const call = calls.find((c) => c.url === '/api/posts/600');
    expect(call.init.method).toBe('PATCH');
    expect(JSON.parse(call.init.body)).toEqual({ text: 'Reunião às 19h' });
    expect(onChange).toHaveBeenCalled();
  });

  it('sem permissão (prazo, outra pessoa) não aparece "Editar"; post editado mostra o selo e o histórico', async () => {
    const post = makePost({ id: '601', author_id: '2', text: 'versão nova', edit_count: 1, edited_at: new Date().toISOString(), viewer: { liked: false, reposted: false, can_edit: false } });
    mockFetch([[/\/edicoes$/, { data: { current: { version: 2, text: 'versão nova', since: new Date().toISOString() }, previous: [{ version: 1, text: 'versão velha', until: new Date().toISOString() }] } }]]);
    renderCard(post);
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '· editado' }));
    const hist = await screen.findByRole('region', { name: 'Histórico de edições' });
    expect(within(hist).getByText('versão velha')).toBeInTheDocument();
    expect(within(hist).getByText(/Versão 1, até/)).toBeInTheDocument();
  });
});

describe('citar post', () => {
  it('o botão de repost abre "Repostar" e "Citar"; citar envia quote_of_id com o post citado na janela', async () => {
    const post = makePost({ id: '700', author_id: '2', text: 'Mapa do bairro pronto' });
    const calls = mockFetch([[/\/api\/posts$/, { data: makePost({ id: '701', text: 'Vale ver', referenced_posts: [{ type: 'quoted', id: '700' }] }), includes: { users: [], posts: [post] } }]]);
    renderCard(post);
    await userEvent.click(screen.getByRole('button', { name: 'Repostar ou citar' }));
    expect(screen.getByRole('menuitem', { name: 'Repostar' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Citar' }));
    const dialog = screen.getByRole('dialog', { name: 'Citar post' });
    expect(within(dialog).getByText('Mapa do bairro pronto')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Novo post'), 'Vale ver');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Citar' }));
    expect(JSON.parse(calls.find((c) => c.url === '/api/posts').init.body)).toEqual({ text: 'Vale ver', reply_to_id: null, quote_of_id: '700' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a citação mostra o post citado; se ele sumiu, um aviso', () => {
    const orig = makePost({ id: '800', author_id: '2', text: 'post original citado' });
    const q = makePost({ id: '801', author_id: '1', text: 'minha citação', referenced_posts: [{ type: 'quoted', id: '800' }] });
    renderCard(q, { 800: orig });
    expect(screen.getByRole('button', { name: /Post citado de Bruno Lima: post original citado/ })).toBeInTheDocument();
  });

  it('citação de post indisponível', () => {
    const q = makePost({ id: '802', author_id: '1', text: 'citei algo que sumiu', referenced_posts: [{ type: 'quoted', id: '999' }] });
    renderCard(q);
    expect(screen.getByText('Este post não está disponível.')).toBeInTheDocument();
  });
});
