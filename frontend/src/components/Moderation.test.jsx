import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext.jsx';
import { makePost, mockFetch, users } from '../test/fixtures.js';
import Feed from './Feed.jsx';

vi.mock('../lib/socket.js', () => ({ getSocket: () => ({ on: vi.fn(), off: vi.fn() }), closeSocket: vi.fn() }));

const page = (posts) => ({ data: posts, includes: { users: [users.ana, users.bruno], posts: [] }, meta: { result_count: posts.length } });
const REASONS = { data: [{ id: 'spam', label: 'Spam ou propaganda repetitiva' }, { id: 'outro', label: 'Outro motivo (explique)' }] };

function setup(posts, extra = []) {
  const calls = mockFetch([
    [/\/api\/auth\/refresh$/, { token: 't', user: users.ana }],
    [/\/api\/denuncias\/motivos$/, REASONS],
    ...extra,
    [/\/api\/posts/, page(posts)],
  ]);
  render(
    <MemoryRouter>
      <AuthProvider>
        <Feed endpoint="/api/posts" />
      </AuthProvider>
    </MemoryRouter>,
  );
  return calls;
}

describe('moderação no feed', () => {
  it('silenciar some com os posts da pessoa e deixa um aviso com "Desfazer"', async () => {
    const a = makePost({ text: 'primeiro do bruno', author_id: '2' });
    const b = makePost({ text: 'segundo do bruno', author_id: '2' });
    const mine = makePost({ text: 'post da ana', author_id: '1' });
    const calls = setup([a, b, mine], [[/\/api\/users\/bruno\/mute$/, { data: { muting: true } }]]);
    await screen.findByText('primeiro do bruno');
    // Post próprio não tem menu de moderação.
    expect(screen.getAllByRole('button', { name: 'Mais opções' })).toHaveLength(2);
    await userEvent.click(screen.getAllByRole('button', { name: 'Mais opções' })[0]);
    await userEvent.click(screen.getByRole('menuitem', { name: /Silenciar @bruno/ }));
    expect(await screen.findByText(/Você silenciou @bruno/)).toBeInTheDocument();
    expect(screen.queryByText('segundo do bruno')).not.toBeInTheDocument();
    expect(screen.getByText('post da ana')).toBeInTheDocument();
    const call = calls.find((c) => c.url === '/api/users/bruno/mute');
    expect(call.init.method).toBe('POST');
    await userEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(calls.filter((c) => c.url === '/api/users/bruno/mute').at(-1).init.method).toBe('DELETE');
    expect(await screen.findByText('primeiro do bruno')).toBeInTheDocument();
  });

  it('bloquear pede confirmação antes', async () => {
    const calls = setup([makePost({ text: 'do bruno', author_id: '2' })], [[/\/block$/, { data: { blocking: true } }]]);
    await userEvent.click(await screen.findByRole('button', { name: 'Mais opções' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Bloquear @bruno/ }));
    expect(calls.some((c) => c.url.endsWith('/block'))).toBe(false);
    expect(screen.getByText(/Vocês deixam de ver os posts um do outro/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Bloquear' }));
    expect(await screen.findByText('Você bloqueou @bruno.')).toBeInTheDocument();
  });

  it('denunciar: exige motivo, envia o post e oferece bloquear depois', async () => {
    const p = makePost({ text: 'golpe do bruno', author_id: '2' });
    const calls = setup([p], [
      [/\/api\/denuncias$/, { data: { id: '9', status: 'aberta' } }],
      [/\/block$/, { data: { blocking: true } }],
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Mais opções' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Denunciar post' }));
    const dialog = await screen.findByRole('dialog', { name: 'Denunciar post' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar denúncia' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Escolha um motivo.');
    await userEvent.click(await within(dialog).findByLabelText('Outro motivo (explique)'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar denúncia' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Explique o motivo');
    await userEvent.type(within(dialog).getByRole('textbox'), 'pede senha');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar denúncia' }));
    expect(await within(dialog).findByText('Denúncia enviada')).toBeInTheDocument();
    const sent = JSON.parse(calls.find((c) => c.url === '/api/denuncias').init.body);
    expect(sent).toEqual({ post_id: p.id, reason: 'outro', details: 'pede senha' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bloquear @bruno' }));
    expect(await within(dialog).findByText('Você bloqueou @bruno.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pronto' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
