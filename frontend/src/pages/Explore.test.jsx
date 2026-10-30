import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext.jsx';
import { makePost, mockFetch, users } from '../test/fixtures.js';
import Explore from './Explore.jsx';

vi.mock('../lib/socket.js', () => ({ getSocket: () => ({ on: vi.fn(), off: vi.fn() }), closeSocket: vi.fn() }));

const timeline = { data: [makePost({ id: '700', text: 'post da timeline pública', author_id: '2' })], includes: { users: [users.bruno], posts: [] }, meta: { result_count: 1 } };
const found = { data: [makePost({ id: '701', text: 'O ônibus atrasou de novo', author_id: '2' })], includes: { users: [users.bruno], posts: [] }, meta: { result_count: 1 } };

function Where() {
  const { search } = useLocation();
  return <output aria-label="endereço">{search}</output>;
}

const renderAt = (path = '/explorar') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/explorar" element={<><Explore /><Where /></>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

describe('<Explore> com busca', () => {
  it('sem busca mostra a timeline; ao digitar, busca posts (aba Posts) e guarda a busca na URL', async () => {
    const calls = mockFetch([
      [/\/api\/posts\/busca/, found],
      [/\/api\/posts\?/, timeline],
    ]);
    renderAt();
    expect(await screen.findByText('post da timeline pública')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Buscar posts e pessoas'), 'onibus');
    expect(await screen.findByText('O ônibus atrasou de novo')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Posts' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('endereço')).toHaveTextContent('?q=onibus');
    const searches = calls.filter((c) => c.url.startsWith('/api/posts/busca'));
    // Espera parar de digitar: uma busca só, não uma por letra.
    expect(searches).toHaveLength(1);
    expect(searches[0].url).toMatch(/q=onibus/);
  });

  it('aba Pessoas busca contas; uma letra só pede mais', async () => {
    mockFetch([
      [/\/api\/users\?q=bru/, { data: [users.bruno] }],
      [/\/api\/posts\/busca/, { ...found, data: [] }],
    ]);
    renderAt('/explorar?q=bru');
    await userEvent.click(await screen.findByRole('tab', { name: 'Pessoas' }));
    expect(await screen.findByRole('link', { name: /Bruno Lima/ })).toHaveAttribute('href', '/u/bruno');
    expect(screen.getByLabelText('endereço')).toHaveTextContent('aba=pessoas');

    await userEvent.clear(screen.getByLabelText('Buscar posts e pessoas'));
    await userEvent.type(screen.getByLabelText('Buscar posts e pessoas'), 'b');
    expect(await screen.findByText('Digite pelo menos 2 letras.')).toBeInTheDocument();
  });

  it('sem resultado, diz isso', async () => {
    mockFetch([[/\/api\/posts\/busca/, { data: [], includes: { users: [], posts: [] }, meta: { result_count: 0 } }]]);
    renderAt('/explorar?q=futebol');
    expect(await screen.findByText('Nenhum post com essas palavras.')).toBeInTheDocument();
  });
});
