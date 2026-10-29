import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { mockFetch, users } from '../test/fixtures.js';
import Rules from './Rules.jsx';

const auth = vi.hoisted(() => ({ user: null }));
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => auth }));

const regras = { data: { rules: [{ id: '1', position: 1, title: 'Respeite as pessoas', description: 'Sem assédio.' }], moderators: [] } };

describe('<Rules>', () => {
  it('sem login, a página é a região principal (<main>)', async () => {
    auth.user = null;
    mockFetch([[/\/api\/instancia\/regras/, regras]]);
    render(<MemoryRouter><Rules /></MemoryRouter>);
    expect(screen.getByRole('main')).toContainElement(await screen.findByText('Respeite as pessoas'));
  });

  it('logada, não cria um segundo <main> dentro do Layout', async () => {
    auth.user = users.ana;
    mockFetch([[/\/api\/instancia\/regras/, regras]]);
    render(<MemoryRouter><Rules /></MemoryRouter>);
    await screen.findByText('Respeite as pessoas');
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
  });
});
