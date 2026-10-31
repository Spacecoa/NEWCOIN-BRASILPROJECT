import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext.jsx';
import { mockFetch, users } from '../test/fixtures.js';
import Login from './Login.jsx';
import Privacy from './Privacy.jsx';

vi.mock('../lib/socket.js', () => ({ getSocket: () => ({ on: vi.fn(), off: vi.fn() }), closeSocket: vi.fn() }));

const renderPrivacy = () =>
  render(
    <MemoryRouter initialEntries={['/privacidade']}>
      <AuthProvider>
        <Routes>
          <Route path="/privacidade" element={<Privacy />} />
          <Route path="/login" element={<Login />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

const base = [
  [/\/api\/auth\/refresh$/, { token: 't1', user: users.ana }],
  [/\/api\/conta\/(bloqueados|silenciados|decisoes)$/, { data: [] }],
  [/\/api\/denuncias$/, { data: [] }],
];

afterEach(() => vi.unstubAllGlobals());

describe('privacidade e dados', () => {
  it('baixar meus dados gera um arquivo JSON com o nome da conta e a data', async () => {
    const calls = mockFetch([[/\/api\/conta\/dados$/, { formato: 'agora-dados/1', gerado_em: '2026-11-02T10:00:00.000Z', conta: { username: 'ana_dev' } }], ...base]);
    const created = [];
    vi.stubGlobal('URL', { ...URL, createObjectURL: (b) => (created.push(b), 'blob:x'), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      created.push(this.download);
    });
    renderPrivacy();
    expect(await screen.findByRole('heading', { name: 'Privacidade e dados' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Baixar arquivo (JSON)' }));
    expect(await screen.findByText('Arquivo baixado.')).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/conta/dados')).toBe(true);
    expect(created).toContain('agora-dados-ana_dev-2026-11-02.json');
    expect(JSON.parse(await created[0].text())).toMatchObject({ formato: 'agora-dados/1' });
    click.mockRestore();
  });

  it('excluir pede confirmação e senha; senha errada mostra o erro; certa sai da conta com aviso', async () => {
    let wrong = true;
    const calls = mockFetch(base);
    const ok = globalThis.fetch;
    vi.stubGlobal('fetch', async (url, init = {}) => {
      if (url === '/api/conta' && init.method === 'DELETE') {
        calls.push({ url, init });
        if (wrong) return { ok: false, status: 403, json: async () => ({ error: 'Senha incorreta' }) };
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return ok(url, init);
    });
    renderPrivacy();
    await userEvent.click(await screen.findByRole('button', { name: 'Quero excluir minha conta' }));
    const form = screen.getByRole('button', { name: 'Excluir conta de vez' }).closest('form');
    expect(within(form).getByText(/Seu @ fica reservado/)).toBeInTheDocument();

    await userEvent.click(within(form).getByRole('checkbox'));
    await userEvent.type(within(form).getByLabelText('Sua senha, para confirmar'), 'errada');
    await userEvent.click(within(form).getByRole('button', { name: 'Excluir conta de vez' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Senha incorreta');

    wrong = false;
    await userEvent.clear(within(form).getByLabelText('Sua senha, para confirmar'));
    await userEvent.type(within(form).getByLabelText('Sua senha, para confirmar'), 'senha1234');
    await userEvent.click(within(form).getByRole('button', { name: 'Excluir conta de vez' }));
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Sua conta foi excluída.');
    const sent = calls.filter((c) => c.url === '/api/conta').map((c) => JSON.parse(c.init.body));
    expect(sent).toEqual([{ password: 'errada' }, { password: 'senha1234' }]);
  });
});
