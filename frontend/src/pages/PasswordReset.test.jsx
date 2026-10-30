import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext.jsx';
import { mockFetch } from '../test/fixtures.js';
import ForgotPassword from './ForgotPassword.jsx';
import Login from './Login.jsx';
import ResetPassword from './ResetPassword.jsx';

vi.mock('../lib/socket.js', () => ({ getSocket: () => ({ on: vi.fn(), off: vi.fn() }), closeSocket: vi.fn() }));

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/esqueci-senha" element={<ForgotPassword />} />
          <Route path="/redefinir-senha" element={<ResetPassword />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

const SENT = 'Se houver uma conta com este e-mail, enviamos um link para criar uma senha nova. Ele vale por 30 minutos.';
const TOKEN = 'a'.repeat(43);

describe('recuperar senha', () => {
  it('o login leva a "Esqueci minha senha", que pede o e-mail e mostra a mesma mensagem para qualquer e-mail', async () => {
    const calls = mockFetch([[/\/api\/auth\/senha\/esqueci$/, { ok: true, message: SENT }]]);
    renderAt('/login');
    await userEvent.click(await screen.findByRole('link', { name: 'Esqueci minha senha' }));
    await userEvent.type(await screen.findByLabelText('E-mail'), ' nina@exemplo.test ');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar link' }));
    expect(await screen.findByRole('status')).toHaveTextContent(SENT);
    expect(JSON.parse(calls.find((c) => c.url === '/api/auth/senha/esqueci').init.body)).toEqual({ email: 'nina@exemplo.test' });
    expect(screen.getByRole('link', { name: 'Voltar para entrar' })).toHaveAttribute('href', '/login');
  });

  it('redefinir: senhas diferentes são recusadas na tela; iguais salvam e levam ao login com aviso', async () => {
    const calls = mockFetch([[/\/api\/auth\/senha\/redefinir$/, { ok: true }]]);
    renderAt(`/redefinir-senha?token=${TOKEN}`);
    await userEvent.type(await screen.findByLabelText(/Senha nova/), 'senha-nova-123');
    await userEvent.type(screen.getByLabelText('Repita a senha nova'), 'senha-errada-1');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar senha nova' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('As duas senhas não são iguais.');
    expect(calls.some((c) => c.url === '/api/auth/senha/redefinir')).toBe(false);

    await userEvent.clear(screen.getByLabelText('Repita a senha nova'));
    await userEvent.type(screen.getByLabelText('Repita a senha nova'), 'senha-nova-123');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar senha nova' }));
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Senha nova salva. Entre com ela.');
    expect(JSON.parse(calls.find((c) => c.url === '/api/auth/senha/redefinir').init.body)).toEqual({ token: TOKEN, password: 'senha-nova-123' });
  });

  it('link sem token oferece pedir um novo; link vencido mostra o erro do servidor', async () => {
    mockFetch([]);
    const { unmount } = renderAt('/redefinir-senha');
    expect(await screen.findByRole('heading', { name: 'Link incompleto' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pedir um link novo' })).toHaveAttribute('href', '/esqueci-senha');
    unmount();

    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: !String(url).includes('redefinir') && false,
      status: String(url).includes('redefinir') ? 400 : 401,
      json: async () => ({ error: String(url).includes('redefinir') ? 'Este link não vale mais: ele venceu ou já foi usado. Peça um novo.' : 'Sessão inválida' }),
    })));
    renderAt(`/redefinir-senha?token=${TOKEN}`);
    await userEvent.type(await screen.findByLabelText(/Senha nova/), 'senha-nova-123');
    await userEvent.type(screen.getByLabelText('Repita a senha nova'), 'senha-nova-123');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar senha nova' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/venceu ou já foi usado/);
  });
});
