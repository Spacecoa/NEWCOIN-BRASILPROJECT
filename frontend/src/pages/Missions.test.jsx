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
  principles: ['Sem pontos, sem sequências e sem ranking individual.'],
  missions: [
    { id: 'boas_vindas', title: 'Dê boas-vindas', description: 'Responda alguém novo.', why: 'A primeira resposta decide se alguém fica.', status: 'todo', suggestions: [{ type: 'user', username: 'nina_nova', display_name: 'Nina Barros' }] },
    { id: 'convidar', title: 'Traga alguém de confiança', description: 'Gere um convite.', why: 'Confiança.', status: 'todo', suggestions: [] },
    { id: 'ponte', title: 'Construa uma ponte', description: 'Siga alguém novo.', why: 'Fora da bolha.', status: 'done', suggestions: [] },
  ],
  ...over,
});

const renderPage = () => render(<MemoryRouter><Missions /></MemoryRouter>);

describe('<Missions>', () => {
  it('mostra a meta coletiva, as missões com alvos concretos e nenhum ponto', async () => {
    mockFetch([[/\/api\/missoes$/, payload()], [/\/api\/convites$/, { data: [] }]]);
    renderPage();
    expect(await screen.findByText('3 de 4 pessoas novas desta semana já foram recebidas')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');
    expect(screen.getByText('1 de 3 hoje. Renovam à meia-noite.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Nina Barros/ })).toHaveAttribute('href', '/u/nina_nova');
    expect(screen.getByText('Feito. Obrigado por cuidar da rede.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d+\s*(pontos|xp|dias seguidos)/i);
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
});
