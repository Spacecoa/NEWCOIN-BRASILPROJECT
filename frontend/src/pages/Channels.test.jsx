import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { OFFLINE_MESSAGE } from '../lib/api.js';
import Channels from './Channels.jsx';

describe('<Channels> sem rede', () => {
  it('mostra a mensagem em português (não "Failed to fetch") e "Tentar de novo" carrega a lista', async () => {
    let online = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (!online) throw new TypeError('Failed to fetch');
        return { ok: true, status: 200, json: async () => ({ data: [{ id: '1', slug: 'cafe', title: 'Café', kind: 'group', viewer_role: null }] }) };
      }),
    );
    render(<MemoryRouter><Channels /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent(OFFLINE_MESSAGE);
    expect(screen.queryByText('Carregando…')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Failed to fetch/);

    online = true;
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Café')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
