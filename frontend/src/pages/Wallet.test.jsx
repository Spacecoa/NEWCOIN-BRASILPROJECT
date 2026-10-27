import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { mockFetch } from '../test/fixtures.js';
import Wallet from './Wallet.jsx';

describe('<Wallet>', () => {
  it('mostra saldo, totais, regras de utilidade nula e o extrato legível', async () => {
    mockFetch([
      [
        /\/api\/carteira$/,
        {
          token: { name: 'NewCoin', symbol: 'NWC', tip_amount: 1 },
          balance: 6,
          totals: { from_missions: 4, received: 1, given: 2 },
          ledger: [
            { id: '5', amount: 1, kind: 'tip_received', counterpart: 'bruno', post_id: '77', created_at: new Date().toISOString() },
            { id: '4', amount: -1, kind: 'tip_sent', counterpart: 'carla', post_id: '66', created_at: new Date().toISOString() },
            { id: '3', amount: 2, kind: 'mission', mission: 'curtir', created_at: new Date().toISOString() },
            { id: '1', amount: 3, kind: 'grant', created_at: new Date().toISOString() },
          ],
        },
      ],
    ]);
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(await screen.findByText('Seu saldo')).toBeInTheDocument();
    expect(screen.getByText(/não é dinheiro nem criptomoeda/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '@bruno recompensou seu post' })).toHaveAttribute('href', '/post/77');
    expect(screen.getByText('Você recompensou @carla')).toBeInTheDocument();
    expect(screen.getByText('Missão: Curta 5 posts')).toBeInTheDocument();
    expect(screen.getByText('Saldo de boas-vindas')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
  });
});
