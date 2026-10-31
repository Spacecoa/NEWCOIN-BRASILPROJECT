import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../auth/AuthContext.jsx';
import { mockFetch, users } from '../test/fixtures.js';
import Login from './Login.jsx';
import Privacy from './Privacy.jsx';

vi.mock('../lib/socket.js', () => ({ getSocket: () => ({ on: vi.fn(), off: vi.fn() }), closeSocket: vi.fn() }));

// Como no App: sem conta, a página dá lugar à leitura de visitante, com o aviso no topo.
function Shell() {
  const { user, notice } = useAuth();
  return user ? <Privacy /> : <p role="status">{notice}</p>;
}

const renderPrivacy = () =>
  render(
    <MemoryRouter initialEntries={['/privacidade']}>
      <AuthProvider>
        <Routes>
          <Route path="/privacidade" element={<Shell />} />
          <Route path="/login" element={<Login />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

const base = [
  [/\/api\/auth\/refresh$/, { token: 't1', user: users.ana }],
  [/\/api\/conta\/(bloqueados|silenciados|decisoes)$/, { data: [] }],
  [/\/api\/denuncias$/, { data: [] }],
  [/\/api\/instancia\/termo$/, { data: { version: 'v1', contact: 'pesquisa@exemplo.edu.br', summary: '', sections: [] } }],
];

afterEach(() => vi.unstubAllGlobals());

describe('privacidade e dados', () => {
  it('abre com o resumo do piloto: quem vê o quê, o termo, os controles e o contato', async () => {
    mockFetch([[/\/api\/auth\/refresh$/, { token: 't1', user: { ...users.ana, consent: { version: 'v1', accepted_at: '2026-10-20T12:00:00Z', current: 'v1', pending: false } } }], ...base.slice(1)]);
    renderPrivacy();
    expect(await screen.findByRole('heading', { name: 'Quem vê o quê' })).toBeInTheDocument();
    for (const t of ['Público', 'Restrito', 'Só você', 'Não guardamos']) expect(screen.getByText(t)).toBeInTheDocument();
    expect(screen.getByText(/Você aceitou o termo do piloto em 20 de outubro de 2026/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ler o termo do piloto' })).toHaveAttribute('href', '/termo');
    expect(screen.getByRole('link', { name: /Contagem de tempo/ })).toHaveAttribute('href', '/interesses');
    expect(await screen.findByText(/pesquisa@exemplo.edu.br/)).toBeInTheDocument();
  });

  it('baixar meus dados gera um arquivo JSON com o nome da conta e a data', async () => {
    const calls = mockFetch([[/\/api\/conta\/dados$/, { formato: 'agora-dados/1', gerado_em: '2026-11-02T10:00:00.000Z', conta: { username: 'ana_dev' } }], ...base]);
    const created = [];
    vi.stubGlobal('URL', { ...URL, createObjectURL: (b) => (created.push(b), 'blob:x'), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      created.push(this.download);
    });
    localStorage.setItem('agora.algo.v1.1', JSON.stringify({ v: 1, learned: { topics: { clima: 0.5 }, authors: {} } }));
    renderPrivacy();
    expect(await screen.findByRole('heading', { name: 'Privacidade e dados' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Baixar arquivo (JSON)' }));
    expect(await screen.findByText('Arquivo baixado.')).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/conta/dados')).toBe(true);
    expect(created).toContain('agora-dados-ana_dev-2026-11-02.json');
    expect(JSON.parse(await created[0].text())).toMatchObject({ formato: 'agora-dados/1', neste_aparelho: { algoritmo: { learned: { topics: { clima: 0.5 } } } } });
    localStorage.clear();
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
    localStorage.setItem('agora.algo.v1.1', JSON.stringify({ v: 1 }));
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
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sua conta foi excluída.'));
    const sent = calls.filter((c) => c.url === '/api/conta').map((c) => JSON.parse(c.init.body));
    expect(sent).toEqual([{ password: 'errada' }, { password: 'senha1234' }]);
    // O algoritmo do "Para você" sai deste aparelho junto com a conta.
    expect(localStorage.getItem('agora.algo.v1.1')).toBeNull();
  });
});
