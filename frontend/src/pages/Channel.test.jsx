import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext.jsx';
import { mockFetch, users } from '../test/fixtures.js';
import Channel from './Channel.jsx';

vi.mock('../lib/socket.js', () => ({ getSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), emitWithAck: vi.fn(async () => ({ ok: true, pts: 3 })), connected: true }), closeSocket: vi.fn() }));
// jsdom não implementa scrollIntoView.
Element.prototype.scrollIntoView = vi.fn();

const msg = (id, pts, extra) => ({ id, channel_id: '9', author_id: '2', text: `texto ${id}`, pts, created_at: new Date().toISOString(), reactions: [], ...extra });

describe('<Channel> com bloqueio e silêncio', () => {
  it('mensagem oculta vira aviso; silenciada fica recolhida até "Mostrar"', async () => {
    mockFetch([
      [/\/api\/auth\/refresh$/, { token: 't', user: users.ana }],
      [/\/api\/channels\/sala\/messages/, {
        data: [
          msg('13', 3, { muted: true, text: 'opinião da pessoa silenciada' }),
          msg('12', 2, { hidden: 'bloqueio', text: null, author_id: null }),
          msg('11', 1, { hidden: 'suspensa', text: null, author_id: null }),
        ],
        includes: { users: [users.bruno] },
        meta: { pts: 3 },
      }],
      [/\/api\/channels\/sala$/, { data: { id: '9', slug: 'sala', title: 'Sala', kind: 'group', viewer_role: 'member', pts: 3 } }],
    ]);
    render(
      <MemoryRouter initialEntries={['/canais/sala']}>
        <AuthProvider>
          <Routes>
            <Route path="/canais/:slug" element={<Channel />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Mensagem oculta por bloqueio/)).toBeInTheDocument();
    expect(screen.getByText(/Mensagem de uma conta suspensa/)).toBeInTheDocument();
    expect(screen.queryByText('opinião da pessoa silenciada')).not.toBeInTheDocument();
    expect(screen.getByText('Mensagem de @bruno (silenciada)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar' }));
    expect(screen.getByText('opinião da pessoa silenciada')).toBeInTheDocument();
  });
});

function renderChannel() {
  render(
    <MemoryRouter initialEntries={['/canais/sala']}>
      <AuthProvider>
        <Routes>
          <Route path="/canais/:slug" element={<Channel />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('<Channel> grupo fechado e remoção (docs/14, C-1 e C-2)', () => {
  it('quem não entrou no grupo não carrega mensagens e vê o convite para entrar', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/refresh$/, { token: 't', user: users.ana }],
      [/\/api\/channels\/sala$/, { data: { id: '9', slug: 'sala', title: 'Sala', kind: 'group', viewer_role: null, pts: 3, member_count: 2 } }],
    ]);
    renderChannel();
    expect(await screen.findByText(/Este grupo é só para quem entrou/)).toBeInTheDocument();
    expect(calls.some((c) => /\/messages/.test(c.url))).toBe(false);
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('quem administra vê "Remover" nas mensagens de outras pessoas, e a remoção confirma antes', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/refresh$/, { token: 't', user: users.ana }],
      [/\/api\/channels\/sala\/members\/bruno$/, { data: { username: 'bruno', removed: true, banned: true } }],
      [/\/api\/channels\/sala\/difference/, { data: [], includes: { users: [] }, meta: { pts: 1, too_long: false } }],
      [/\/api\/channels\/sala\/messages/, { data: [msg('11', 1)], includes: { users: [users.bruno] }, meta: { pts: 1 } }],
      [/\/api\/channels\/sala$/, { data: { id: '9', slug: 'sala', title: 'Sala', kind: 'group', viewer_role: 'owner', pts: 1, member_count: 2 } }],
    ]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderChannel();
    await userEvent.click(await screen.findByRole('button', { name: 'Remover' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/@bruno/));
    expect(calls.some((c) => /members\/bruno$/.test(c.url) && c.init.method === 'DELETE')).toBe(true);
    expect(await screen.findByText(/@bruno foi removido/)).toBeInTheDocument();
    confirm.mockRestore();
  });
});

