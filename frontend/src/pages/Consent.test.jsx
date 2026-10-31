import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../auth/AuthContext.jsx';
import Layout from '../components/Layout.jsx';
import { mockFetch, users } from '../test/fixtures.js';
import Consent from './Consent.jsx';

vi.mock('../lib/socket.js', () => ({ getSocket: () => ({ on: vi.fn(), off: vi.fn() }), closeSocket: vi.fn() }));

const TERM = {
  version: 'v2',
  summary: 'Participar é voluntário.',
  sections: [{ title: 'O que o app guarda', items: ['Conta, posts e minutos de uso.'] }],
  accept_label: 'Tenho 18 anos ou mais, li o termo e aceito participar do piloto.',
};
const consent = (pending) => ({ version: pending ? 'v1' : 'v2', accepted_at: '2026-10-20T12:00:00Z', current: 'v2', pending });

// Como no App: a navegação só aparece depois que a sessão foi lida.
function Shell() {
  const { user } = useAuth();
  return user ? <Layout /> : null;
}

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/termo" element={<Consent />} />
          <Route element={<Shell />}>
            <Route index element={<p>Início do app</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('termo do piloto', () => {
  it('/termo mostra o texto para quem ainda não tem conta, com o caminho para o cadastro', async () => {
    mockFetch([[/\/api\/instancia\/termo$/, { data: TERM }]]);
    renderAt('/termo');
    expect(await screen.findByText('Conta, posts e minutos de uso.')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByText('Versão do termo: v2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Criar conta' })).toHaveAttribute('href', '/cadastro');
  });

  it('conta com o termo antigo vê o termo novo antes do app; aceitar abre o app', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/refresh$/, { token: 't1', user: { ...users.ana, consent: consent(true) } }],
      [/\/api\/instancia\/termo$/, { data: TERM }],
      [/\/api\/conta\/termo$/, { user: { ...users.ana, consent: consent(false) } }],
    ]);
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'O termo do piloto mudou' })).toBeInTheDocument();
    expect(screen.queryByText('Início do app')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('checkbox', { name: TERM.accept_label }));
    await userEvent.click(screen.getByRole('button', { name: 'Aceito e continuo' }));
    expect(await screen.findByText('Início do app')).toBeInTheDocument();
    expect(JSON.parse(calls.find((c) => c.url === '/api/conta/termo').init.body)).toEqual({ version: 'v2' });
  });

  it('"Não aceito" oferece baixar os dados, excluir a conta ou sair', async () => {
    mockFetch([
      [/\/api\/auth\/refresh$/, { token: 't1', user: { ...users.ana, consent: consent(true) } }],
      [/\/api\/instancia\/termo$/, { data: TERM }],
    ]);
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Não aceito' }));
    expect(screen.getByRole('button', { name: 'Baixar arquivo (JSON)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quero excluir minha conta' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sair e decidir depois' })).toBeInTheDocument();
  });

  it('logada e em dia, /termo mostra quando aceitou e onde sair', async () => {
    mockFetch([
      [/\/api\/auth\/refresh$/, { token: 't1', user: { ...users.ana, consent: consent(false) } }],
      [/\/api\/instancia\/termo$/, { data: TERM }],
    ]);
    renderAt('/termo');
    expect(await screen.findByRole('status')).toHaveTextContent('Você aceitou esta versão em 20 de outubro de 2026');
    expect(screen.getByRole('link', { name: 'Privacidade e dados' })).toHaveAttribute('href', '/privacidade');
  });
});
