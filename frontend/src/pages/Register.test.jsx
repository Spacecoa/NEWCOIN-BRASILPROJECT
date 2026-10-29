import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../auth/AuthContext.jsx';
import { mockFetch } from '../test/fixtures.js';
import Register from './Register.jsx';

describe('<Register> com convite', () => {
  it('lê ?convite= da URL e envia invite_code no cadastro', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/register$/, { token: 't', user: { id: '1', username: 'nina' } }],
      [/\/api\/instancia\/regras$/, { data: { rules: [{ id: '1', position: 1, title: 'Respeite as pessoas', description: 'Sem assédio.' }], moderators: [] } }],
    ]);
    render(
      <MemoryRouter initialEntries={['/cadastro?convite=ABCD2345']}>
        <AuthProvider>
          <Register />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { name: 'Você foi convidada(o)' }));
    await userEvent.type(screen.getByLabelText(/Usuário/), 'nina');
    await userEvent.type(screen.getByLabelText('E-mail'), 'nina@x.io');
    await userEvent.type(screen.getByLabelText(/Senha/), 'senha1234');
    expect(await screen.findByText('Respeite as pessoas')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /Li e aceito as regras/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));
    const body = JSON.parse(calls.find((c) => c.url === '/api/auth/register').init.body);
    expect(body).toMatchObject({ username: 'nina', invite_code: 'abcd2345', accept_rules: true });
  });
});
