import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makePost, mockFetch } from '../test/fixtures.js';
import { AuthProvider } from '../auth/AuthContext.jsx';
import WhyPanel from './WhyPanel.jsx';

const wrap = (ui) => <AuthProvider>{ui}</AuthProvider>;

const ranked = makePost({
  ranking: {
    position: 2,
    score: 0.71,
    topics: [{ id: 'bancos', label: 'Bancos de dados' }],
    keywords: [],
    reasons: [
      { fator: 'interesse', valor: 0.9, peso: 0.45, contribuicao: 0.405, detalhe: 'Tópico Bancos de dados (peso 90%)' },
      { fator: 'pessoas', valor: 1, peso: 0.25, contribuicao: 0.25, detalhe: 'Você segue esta pessoa' },
      { fator: 'popularidade', valor: 0.8, peso: 0, contribuicao: 0, detalhe: '40 curtidas e reposts' },
    ],
  },
});

describe('<WhyPanel>', () => {
  it('mostra a posição, a nota e cada fator com seu detalhe', async () => {
    render(wrap(<WhyPanel post={ranked} />));
    await userEvent.click(screen.getByRole('button', { name: /Por que este post\? · nº 2/ }));
    expect(screen.getByText(/Pontuação 71 de 100/)).toHaveTextContent('Bancos de dados');
    expect(screen.getByText('Seus interesses')).toBeInTheDocument();
    expect(screen.getByText('+41')).toBeInTheDocument();
    expect(screen.getByText('Você segue esta pessoa')).toBeInTheDocument();
    expect(screen.getByText('+0')).toBeInTheDocument(); // popularidade não pesa por padrão
  });

  it('"Menos disto" aprende só neste aparelho, esconde o post e não chama a API', async () => {
    const calls = mockFetch([]);
    const onHide = vi.fn();
    const local = { ...ranked, author_id: '2', text: 'Postgres e Redis', ranking: { ...ranked.ranking, local: true } };
    render(wrap(<WhyPanel post={local} onHide={onHide} authorUsername="bruno" />));
    expect(screen.getByRole('button', { name: /calculado neste aparelho/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Por que este post/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Menos disto' }));
    expect(calls.filter((c) => c.url.includes('/feedback'))).toHaveLength(0);
    expect(onHide).toHaveBeenCalledWith(local.id);
    expect(screen.getByText('Anotado: menos posts assim.')).toBeInTheDocument();
  });
});
