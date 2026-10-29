import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { mockFetch } from '../test/fixtures.js';
import Missions from './Missions.jsx';

const payload = (over = {}) => ({
  enabled: true,
  day: '2026-10-27',
  summary: { done: 1, total: 3 },
  collective: { novos_membros_semana: 4, recebidos_semana: 3, perguntas_respondidas_hoje: 2, grupos_ativos_hoje: 1, convites_aceitos_semana: 5 },
  token: { name: 'NewCoin', symbol: 'NWC', balance: 7, earned_today: 2, earned_now: 0 },
  principles: ['Sem sequências e sem ranking individual. Pular não tem custo.'],
  missions: [
    { id: 'curtir', family: 'engajamento', reward: 2, target: 5, title: 'Curta 5 posts', description: 'Curta 5 posts de pelo menos 3 pessoas diferentes.', why: 'Curtir mostra a quem escreveu que alguém leu.', status: 'todo', progress: { current: 3, target: 5, authors: 2, authors_needed: 3 }, suggestions: [] },
    { id: 'boas_vindas', family: 'rede', reward: 3, title: 'Dê boas-vindas', description: 'Responda alguém novo.', why: 'A primeira resposta decide se alguém fica.', status: 'todo', suggestions: [{ type: 'user', username: 'nina_nova', display_name: 'Nina Barros' }] },
    { id: 'convidar', family: 'rede', reward: 4, title: 'Traga alguém de confiança', description: 'Gere um convite.', why: 'Confiança.', status: 'todo', suggestions: [] },
    { id: 'ponte', family: 'engajamento', reward: 2, title: 'Construa uma ponte', description: 'Siga alguém novo.', why: 'Fora da bolha.', status: 'done', suggestions: [] },
  ],
  ...over,
});

const renderPage = () => render(<MemoryRouter><Missions /></MemoryRouter>);

describe('<Missions>', () => {
  it('mostra saldo, meta coletiva, recompensa e progresso das missões, sem sequências', async () => {
    mockFetch([[/\/api\/missoes$/, payload()], [/\/api\/convites$/, { data: [] }]]);
    renderPage();
    expect(await screen.findByText('3 de 4 pessoas novas desta semana já foram recebidas')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')[0]).toHaveAttribute('aria-valuenow', '75');
    expect(screen.getByText('1 de 3 hoje. Renovam à meia-noite.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Nina Barros/ })).toHaveAttribute('href', '/u/nina_nova');
    expect(screen.getByText('Feito. 2 NWC creditados na sua carteira.')).toBeInTheDocument();
    expect(screen.getByText('7 NWC')).toBeInTheDocument();
    expect(screen.getByText('+3 NWC')).toBeInTheDocument();
    expect(screen.getByText('3 de 5 · 2 de 3 pessoas diferentes')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Progresso: Curta 5 posts' })).toHaveAttribute('aria-valuenow', '3');
    expect(document.body.textContent).not.toMatch(/dias seguidos|sequência de \d/i);
  });

  it('pular chama a API e recarrega', async () => {
    const calls = mockFetch([
      [/\/pular$/, { skipped: 'boas_vindas' }],
      [/\/api\/missoes$/, payload()],
      [/\/api\/convites$/, { data: [] }],
    ]);
    renderPage();
    const card = (await screen.findByText('Dê boas-vindas')).closest('li');
    await userEvent.click(within(card).getByRole('button', { name: 'Pular hoje' }));
    expect(calls.some((c) => c.url === '/api/missoes/boas_vindas/pular' && c.init.method === 'POST')).toBe(true);
  });

  it('gera convite e mostra o link para copiar', async () => {
    mockFetch([
      [/\/api\/convites$/, (url, init) => (init.method === 'POST' ? { data: { code: 'abcd2345', path: '/cadastro?convite=abcd2345', used: false } } : { data: [] })],
      [/\/api\/missoes$/, payload()],
    ]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Gerar convite' }));
    expect(await screen.findByLabelText('Link do convite')).toHaveValue(`${window.location.origin}/cadastro?convite=abcd2345`);
    expect(screen.getByText('abcd2345')).toBeInTheDocument();
  });

  it('respeita quem escondeu as missões', async () => {
    mockFetch([[/\/api\/missoes$/, payload({ enabled: false, missions: [] })], [/\/api\/convites$/, { data: [] }]]);
    renderPage();
    expect(await screen.findByText('Você escondeu as missões.')).toBeInTheDocument();
  });

  it('convidar fica disponível mesmo sem a missão de convite no dia, e com as missões escondidas', async () => {
    for (const over of [{ missions: payload().missions.filter((m) => m.id !== 'convidar') }, { enabled: false, missions: [] }]) {
      mockFetch([
        [/\/api\/convites$/, (url, init) => (init.method === 'POST' ? { data: { code: 'wxyz2345', path: '/cadastro?convite=wxyz2345', used: false } } : { data: [] })],
        [/\/api\/missoes$/, payload(over)],
      ]);
      const { unmount } = renderPage();
      const section = await screen.findByRole('region', { name: 'Seus convites' });
      await userEvent.click(within(section).getByRole('button', { name: 'Gerar convite' }));
      expect(await within(section).findByLabelText('Link do convite')).toHaveValue(`${window.location.origin}/cadastro?convite=wxyz2345`);
      unmount();
    }
  });

  it('com a missão de convite no dia, o botão aparece uma vez só (no cartão)', async () => {
    mockFetch([[/\/api\/missoes$/, payload()], [/\/api\/convites$/, { data: [] }]]);
    renderPage();
    await screen.findByText('Traga alguém de confiança');
    expect(screen.getAllByRole('button', { name: 'Gerar convite' })).toHaveLength(1);
  });
});
