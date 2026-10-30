import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext.jsx';
import { mockFetch, users } from '../test/fixtures.js';
import { changeLabel, dateLabel, formatValue, periodLabel } from '../lib/officialData.js';
import Brasil from './Brasil.jsx';

vi.mock('../lib/socket.js', () => ({ getSocket: () => ({ on: vi.fn(), off: vi.fn() }), closeSocket: vi.fn() }));

// Valores SINTÉTICOS de teste.
const src = (over) => ({ key: 'k', role: 'origem', institution: 'IBGE', unit: '%', page: 'https://sidra.ibge.gov.br/tabela/1', latest: null, original: null, last_attempt: null, history: [], ...over });
const DATA = {
  updated_at: new Date().toISOString(),
  indicators: [
    {
      id: 'economia', section: 'Desenvolvimento', title: 'Crescimento da economia (PIB)', unit: '%', decimals: 1, frequency: 'trimestral', why: 'Quanto a produção cresceu.',
      latest: { period: '2026T2', value: 2.1 }, previous: { period: '2026T1', value: 1.6 }, revised: false,
      history: [{ period: '2026T1', value: 1.6 }, { period: '2026T2', value: 2.1 }],
      badge: 'confirmado', checks: { origem: 'ok', consistencia: 'sem_republicacao', independente: 'concorda' }, notes: [],
      sources: [
        src({ key: 'ibge_pib', latest: { period: '2026T2', value: 2.1 }, original: { url: 'https://servicodados.ibge.gov.br/x', sha256: 'a'.repeat(64), fetched_at: new Date().toISOString() } }),
        src({ key: 'bcb_ibcbr', role: 'independente', institution: 'Banco Central (IBC-Br)', label: 'Atividade (IBC-Br)', latest: { period: '202607', value: 1.8 } }),
      ],
    },
    {
      id: 'comida', section: 'Comida', title: 'Custo da cesta básica', unit: 'R$', decimals: 2, frequency: 'mensal', why: 'Quanto custa comer.',
      latest: null, previous: null, revised: false, history: [], badge: 'sem_dados',
      checks: { origem: 'sem_dados', consistencia: null, independente: 'sem_dados' }, notes: ['Origem (DIEESE): fonte ainda não conectada.'],
      sources: [
        src({ key: 'dieese', institution: 'DIEESE', unit: 'R$', last_attempt: { ok: false, error: 'fonte ainda não conectada' } }),
        src({ key: 'alim', role: 'independente', institution: 'IBGE (via Banco Central)', label: 'Alta dos alimentos no IPCA (12 meses)', latest: { period: '202609', value: 3.66 } }),
      ],
    },
  ],
};

function renderPage(data = DATA) {
  mockFetch([
    [/\/api\/auth\/refresh$/, { token: 't', user: users.ana }],
    [/\/api\/dados$/, { data }],
  ]);
  render(
    <MemoryRouter>
      <AuthProvider>
        <Brasil />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('formatação', () => {
  it('períodos, valores e variações em português', () => {
    expect(periodLabel('202609')).toBe('set/2026');
    expect(periodLabel('2026T2')).toBe('2º tri/2026');
    expect(formatValue(750.1, 'R$', 2)).toBe('R$ 750,10');
    expect(formatValue(4.23, '%', 2)).toBe('4,23%');
    expect(formatValue(13.75, '% ao ano', 2)).toBe('13,75% ao ano');
    expect(changeLabel({ value: 2.1 }, { value: 1.6, period: '2026T1' }, '%', 1)).toBe('+0,5 ponto desde 1º tri/2026');
    expect(dateLabel('2026-10-09')).toBe('9 out 2026');
    expect(dateLabel('2026-10')).toBe('out/2026');
  });
});

describe('<Brasil>', () => {
  it('mostra o número, o selo, o porquê e de onde vem; sem dado, mostra a fonte independente e o motivo', async () => {
    renderPage();
    const pib = await screen.findByRole('article', { name: 'Crescimento da economia (PIB)' });
    expect(within(pib).getByText('2,1%')).toBeInTheDocument();
    expect(within(pib).getByText('Confirmado por 3 conferências')).toBeInTheDocument();
    expect(within(pib).getByText(/2º tri\/2026 · \+0,5 ponto desde 1º tri\/2026/)).toBeInTheDocument();
    await userEvent.click(within(pib).getByRole('button', { name: 'De onde vem este número?' }));
    expect(within(pib).getByText('Uma fonte independente concorda')).toBeInTheDocument();
    expect(within(pib).getByText(/original guardado \(sha256 aaaaaaaaaaaa…\)/)).toBeInTheDocument();
    expect(within(pib).getAllByRole('link', { name: /Ver na fonte/ })[0]).toHaveAttribute('href', 'https://sidra.ibge.gov.br/tabela/1');

    const cesta = screen.getByRole('article', { name: 'Custo da cesta básica' });
    expect(within(cesta).getByText('Sem dados ainda')).toBeInTheDocument();
    expect(within(cesta).getByText(/Alta dos alimentos no IPCA \(12 meses\)/)).toBeInTheDocument();
    await userEvent.click(within(cesta).getByRole('button', { name: 'De onde vem este número?' }));
    expect(within(cesta).getByText(/Sem dado: fonte ainda não conectada/)).toBeInTheDocument();
  });

  it('registro conferido à mão: diz a data, que não se atualiza sozinho, e onde mais o número aparece', async () => {
    const reg = {
      checked_at: '2026-10-29',
      published: '2026-09-01',
      url: 'https://agenciadenoticias.ibge.gov.br/release-pib',
      evidence: [{ label: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/x' }],
      history_evidence: [{ label: 'IBGE, PIB de 2021', url: 'https://agenciadenoticias.ibge.gov.br/pib-2021' }],
    };
    const pib = DATA.indicators[0];
    const data = {
      ...DATA,
      mode: 'registro',
      checked_at: '2026-10-29',
      indicators: [{ ...pib, history: [{ period: '2021T4', value: 1.6 }, ...pib.history], sources: [{ ...pib.sources[0], registro: reg }, pib.sources[1]] }],
    };
    renderPage(data);
    expect(await screen.findByText('Conferido em 29 out 2026')).toBeInTheDocument();
    expect(screen.getByText(/não se atualizam sozinhos/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Atualizar agora' })).not.toBeInTheDocument();
    const card = screen.getByRole('article', { name: 'Crescimento da economia (PIB)' });
    await userEvent.click(within(card).getByRole('button', { name: 'De onde vem este número?' }));
    expect(within(card).getByText('O número foi conferido na publicação da origem')).toBeInTheDocument();
    expect(within(card).getByText(/Publicado pela fonte em 1 set 2026 · conferido em 29 out 2026/)).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Agência Brasil' })).toHaveAttribute('href', 'https://agenciabrasil.ebc.com.br/x');
    expect(within(card).getByRole('link', { name: /Ver a publicação/ })).toHaveAttribute('href', reg.url);
    // Histórico de anos: o ponto mais antigo no cartão, a tabela e onde foi conferido.
    expect(within(card).getByText(/Em 4º tri\/2021:/)).toBeInTheDocument();
    expect(within(card).getByRole('table')).toHaveTextContent('4º tri/2021');
    expect(within(card).getByRole('link', { name: 'IBGE, PIB de 2021' })).toBeInTheDocument();
  });
});
