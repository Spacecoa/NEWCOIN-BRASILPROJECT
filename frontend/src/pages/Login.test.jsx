import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../auth/AuthContext.jsx';
import { mockFetch, users } from '../test/fixtures.js';
import Login from './Login.jsx';

vi.mock('../lib/socket.js', () => ({ getSocket: () => ({ on: vi.fn(), off: vi.fn() }), closeSocket: vi.fn() }));

// Mostra a tela de entrar quando não há sessão, e um botão "Sair" quando há.
function Shell() {
  const { user, logout, loading } = useAuth();
  if (loading) return null;
  return user ? <button onClick={logout}>Sair</button> : <Login />;
}
const renderApp = () =>
  render(
    <MemoryRouter>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </MemoryRouter>,
  );

describe('<Login> com e-mail e senha', () => {
  it('envia e-mail e senha, entra, e ao sair volta para a tela com aviso', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/login$/, { token: 't', user: users.ana }],
      [/\/api\/auth\/logout$/, {}],
    ]);
    renderApp();
    const email = await screen.findByLabelText('E-mail');
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocomplete', 'email');
    await userEvent.type(email, '  ana_dev@exemplo.test ');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha1234');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    const body = JSON.parse(calls.find((c) => c.url === '/api/auth/login').init.body);
    expect(body).toEqual({ email: 'ana_dev@exemplo.test', password: 'senha1234' });

    await userEvent.click(await screen.findByRole('button', { name: 'Sair' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Você saiu da sua conta.');
    expect(calls.some((c) => c.url === '/api/auth/logout')).toBe(true);
  });

  it('mostra e oculta a senha', async () => {
    mockFetch([]);
    renderApp();
    const senha = await screen.findByLabelText('Senha');
    expect(senha).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar' }));
    expect(senha).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar' }));
    expect(senha).toHaveAttribute('type', 'password');
  });

  it('erro de credenciais aparece na tela', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => ({ ok: false, status: 401, json: async () => ({ error: url.endsWith('/login') ? 'E-mail ou senha incorretos' : 'Sessão inválida' }) })));
    renderApp();
    await userEvent.type(await screen.findByLabelText('E-mail'), 'ana_dev@exemplo.test');
    await userEvent.type(screen.getByLabelText('Senha'), 'errada');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos');
    expect(screen.queryByRole('status')).not.toBeInTheDocument(); // sem aviso de "sessão terminou" na primeira visita
  });

  it('conta suspensa: mostra a regra e a nota, e o recurso usa o mesmo e-mail e senha', async () => {
    const calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init = {}) => {
        calls.push({ url, init });
        if (url.endsWith('/login'))
          return {
            ok: false,
            status: 403,
            json: async () => ({
              error: 'Esta conta foi suspensa pela moderação da instância.',
              suspension: { since: '2026-10-28T10:00:00Z', rule: { id: '3', position: 3, title: 'Sem golpes' }, note: 'Pedia senhas', can_appeal: true, appeal_status: null },
            }),
          };
        if (url === '/api/recursos/suspensao') return { ok: true, status: 201, json: async () => ({ data: { appeal_status: 'aberto' } }) };
        return { ok: false, status: 401, json: async () => ({ error: 'Sessão inválida' }) };
      }),
    );
    renderApp();
    await userEvent.type(await screen.findByLabelText('E-mail'), 'bob@exemplo.test');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha1234');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText(/Regra 3: Sem golpes/)).toBeInTheDocument();
    expect(screen.getByText(/Pedia senhas/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Recorrer da decisão'), 'Minha conta foi invadida.');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar recurso' }));
    expect(await screen.findByText('Seu recurso está em análise.')).toBeInTheDocument();
    const body = JSON.parse(calls.find((c) => c.url === '/api/recursos/suspensao').init.body);
    expect(body).toEqual({ email: 'bob@exemplo.test', password: 'senha1234', text: 'Minha conta foi invadida.' });
  });
});
