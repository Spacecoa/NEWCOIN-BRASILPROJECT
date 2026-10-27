import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makePost, mockFetch } from '../test/fixtures.js';
import Composer from './Composer.jsx';

describe('<Composer>', () => {
  it('desabilita envio vazio e acima de 280 caracteres', async () => {
    render(<Composer />);
    const button = screen.getByRole('button', { name: 'Postar' });
    expect(button).toBeDisabled();
    const box = screen.getByLabelText('Novo post');
    await userEvent.type(box, 'oi');
    expect(button).toBeEnabled();
    expect(screen.getByText('278')).toBeInTheDocument();
    await userEvent.clear(box);
    await userEvent.click(box);
    await userEvent.paste('a'.repeat(281));
    expect(screen.getByText('-1')).toBeInTheDocument();
    expect(button).toBeDisabled();
  });

  it('envia reply_to_id e devolve o post criado', async () => {
    const created = makePost({ text: 'minha resposta' });
    const calls = mockFetch([[/\/api\/posts$/, { data: created, includes: { users: [] } }]]);
    const onPosted = vi.fn();
    render(<Composer replyTo="42" onPosted={onPosted} />);
    await userEvent.type(screen.getByLabelText('Escreva sua resposta'), 'minha resposta');
    await userEvent.click(screen.getByRole('button', { name: 'Responder' }));
    expect(JSON.parse(calls[0].init.body)).toEqual({ text: 'minha resposta', reply_to_id: '42' });
    expect(onPosted).toHaveBeenCalledWith({ data: created, includes: { users: [] } });
    expect(screen.getByLabelText('Escreva sua resposta')).toHaveValue('');
  });
});
