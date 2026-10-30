import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext.jsx';
import { describeGroup, groupNotifications, unreadStore } from '../lib/notifications.js';
import { makePost, mockFetch, users } from '../test/fixtures.js';
import Notifications from './Notifications.jsx';

vi.mock('../lib/socket.js', () => ({ getSocket: () => ({ on: vi.fn(), off: vi.fn() }), closeSocket: vi.fn() }));

const carla = { id: '3', username: 'carla', display_name: 'Carla Dias' };
const meu = makePost({ id: '900', text: 'meu post sobre redes', author_id: '1' });
const resposta = makePost({ id: '901', text: 'Concordo, e acrescento…', author_id: '2' });
const n = (id, kind, actor, post, read = false) => ({ id, kind, actor_id: actor, post_id: post, created_at: new Date().toISOString(), read });
const payload = {
  data: [n('15', 'reply', '2', '901'), n('14', 'like', '2', '900'), n('13', 'like', '3', '900'), n('12', 'follow', '3', null, true)],
  includes: { users: [users.bruno, carla], posts: [meu, resposta] },
  meta: { result_count: 4, newest_id: '15', oldest_id: '12', unread_count: 3 },
};

describe('agrupar notificações', () => {
  it('junta curtidas seguidas do mesmo post; respostas e menções ficam separadas', () => {
    const g = groupNotifications([n('5', 'like', 'a', 'p'), n('4', 'like', 'b', 'p'), n('3', 'like', 'c', 'p'), n('2', 'reply', 'a', 'r1'), n('1', 'reply', 'b', 'r1')]);
    expect(g.map((x) => [x.kind, x.actor_ids.length])).toEqual([['like', 3], ['reply', 1], ['reply', 1]]);
    const names = { a: 'Ana', b: 'Bruno', c: 'Carla' };
    expect(describeGroup(g[0], names)).toBe('Ana e mais 2 curtiram seu post');
    expect(describeGroup({ ...g[0], actor_ids: ['a', 'b'] }, names)).toBe('Ana e Bruno curtiram seu post');
    expect(describeGroup(g[1], names)).toBe('Ana respondeu você');
  });
});

describe('<Notifications>', () => {
  it('mostra os avisos, destaca os novos e marca como lidos até o mais novo que apareceu', async () => {
    unreadStore.set(3);
    const calls = mockFetch([
      [/\/api\/notificacoes\/lidas$/, { unread_count: 0 }],
      [/\/api\/notificacoes$/, payload],
    ]);
    render(<MemoryRouter><AuthProvider><Notifications /></AuthProvider></MemoryRouter>);
    const reply = await screen.findByRole('link', { name: /Bruno Lima respondeu você/ });
    expect(reply).toHaveAttribute('href', '/post/901');
    expect(reply).toHaveTextContent('Concordo, e acrescento…');
    expect(reply).toHaveTextContent('(nova)');
    expect(screen.getByRole('link', { name: /Bruno Lima e Carla Dias curtiram seu post/ })).toHaveAttribute('href', '/post/900');
    const follow = screen.getByRole('link', { name: /Carla Dias começou a seguir você/ });
    expect(follow).toHaveAttribute('href', '/u/carla');
    expect(within(follow).queryByText('(nova)')).not.toBeInTheDocument();

    const mark = calls.find((c) => c.url === '/api/notificacoes/lidas');
    expect(JSON.parse(mark.init.body)).toEqual({ newest_id: '15' });
    expect(unreadStore.get()).toBe(0);
  });

  it('sem avisos, explica o que vai aparecer; a aba Menções mostra os posts que citam a pessoa', async () => {
    mockFetch([
      [/\/api\/notificacoes$/, { data: [], includes: { users: [], posts: [] }, meta: { result_count: 0, unread_count: 0 } }],
      [/\/api\/auth\/refresh$/, { token: 't', user: users.ana }],
      [/\/api\/mentions/, { data: [makePost({ id: '950', text: 'você viu isso, @ana_dev?', author_id: '2' })], includes: { users: [users.bruno], posts: [] }, meta: { result_count: 1 } }],
    ]);
    render(<MemoryRouter><AuthProvider><Notifications /></AuthProvider></MemoryRouter>);
    expect(await screen.findByText(/Nada por aqui ainda/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Menções' }));
    expect(await screen.findByText(/você viu isso/)).toBeInTheDocument();
  });

  it('avisos que chegam com a tela aberta aparecem num botão, sem pular a lista', async () => {
    unreadStore.set(0);
    mockFetch([[/\/api\/notificacoes$/, { ...payload, meta: { ...payload.meta, unread_count: 0 } }]]);
    render(<MemoryRouter><AuthProvider><Notifications /></AuthProvider></MemoryRouter>);
    await screen.findByRole('link', { name: /respondeu você/ });
    unreadStore.set(2);
    expect(await screen.findByRole('button', { name: 'Mostrar 2 notificações novas' })).toBeInTheDocument();
  });
});
