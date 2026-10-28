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
