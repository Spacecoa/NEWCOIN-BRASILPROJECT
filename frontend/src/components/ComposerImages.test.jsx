import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { makePost, mockFetch, users } from '../test/fixtures.js';
import Composer from './Composer.jsx';
import PostCard from './PostCard.jsx';

// O preparo de verdade usa canvas, que o jsdom não tem: aqui ele devolve um arquivo pronto.
vi.mock('../lib/imageResize.js', () => ({
  ACCEPTED: ['image/jpeg', 'image/png', 'image/webp'],
  prepareImage: vi.fn(async (file) => {
    if (file.type === 'image/gif') throw new Error('Escolha uma imagem JPEG, PNG ou WebP.');
    return { blob: new Blob(['bytes-' + file.name], { type: 'image/jpeg' }), width: 800, height: 600 };
  }),
}));
vi.mock('../lib/socket.js', () => ({ getSocket: () => ({ on: vi.fn(), off: vi.fn() }), closeSocket: vi.fn() }));
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: '1', username: 'ana_dev' } }) }));

beforeAll(() => {
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:previa-${++n}`);
  URL.revokeObjectURL = vi.fn();
});

const foto = (name, type = 'image/jpeg') => new File(['x'], name, { type });

describe('<Composer> com imagens', () => {
  it('a imagem só vai com descrição; envia a imagem e depois o post com id e descrição', async () => {
    const calls = mockFetch([
      [/\/api\/midia$/, { data: { id: '9001', url: '/api/midia/9001' } }],
      [/\/api\/posts$/, { data: makePost({ text: 'horta' }), includes: { users: [] } }],
    ]);
    const onPosted = vi.fn();
    render(<Composer onPosted={onPosted} />);
    await userEvent.type(screen.getByLabelText('Novo post'), 'horta');
    await userEvent.upload(document.querySelector('input[type=file]'), foto('horta.jpg'));
    await screen.findByLabelText(/Descrição da imagem 1/);
    // A prévia é decorativa (alt vazio): quem descreve a imagem é o campo ao lado.
    expect(document.querySelector('form img')).toHaveAttribute('src', 'blob:previa-1');
    const postar = screen.getByRole('button', { name: 'Postar' });
    expect(postar).toBeDisabled();
    expect(screen.getByText('Descreva cada imagem para postar.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Descrição da imagem 1/), 'Canteiro com alfaces');
    expect(postar).toBeEnabled();
    await userEvent.click(postar);
    const up = calls.find((c) => c.url === '/api/midia');
    expect(up.init.body).toBeInstanceOf(Blob);
    expect(up.init.headers['Content-Type']).toBe('image/jpeg');
    const sent = JSON.parse(calls.find((c) => c.url === '/api/posts').init.body);
    expect(sent).toEqual({ text: 'horta', reply_to_id: null, media: [{ id: '9001', alt: 'Canteiro com alfaces' }] });
    expect(onPosted).toHaveBeenCalled();
    expect(screen.queryByLabelText(/Descrição da imagem 1/)).not.toBeInTheDocument();
  });

  it('no máximo 4 imagens; dá para tirar uma; formato errado avisa', async () => {
    mockFetch([]);
    render(<Composer />);
    const input = () => document.querySelector('input[type=file]');
    await userEvent.upload(input(), ['a', 'b', 'c', 'd', 'e'].map((n) => foto(n + '.jpg')));
    expect(await screen.findByRole('alert')).toHaveTextContent('No máximo 4 imagens por post.');
    expect(screen.getAllByLabelText(/Descrição da imagem/)).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Adicionar imagem' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tirar imagem 2' }));
    expect(screen.getAllByLabelText(/Descrição da imagem/)).toHaveLength(3);
    await userEvent.upload(input(), foto('anim.gif', 'image/gif'), { applyAccept: false });
    expect(await screen.findByRole('alert')).toHaveTextContent('Escolha uma imagem JPEG, PNG ou WebP.');
  });
});

describe('<PostCard> com imagem', () => {
  it('mostra a imagem com a descrição no alt e em "Descrição"', async () => {
    const post = makePost({ id: '501', author_id: '2', text: 'mapa do bairro', media: [{ id: '77', type: 'photo', url: '/api/midia/77', width: 720, height: 420, alt: 'Mapa com praça e rio' }] });
    const store = { users: { 2: users.bruno }, posts: { 501: post } };
    render(<MemoryRouter><PostCard post={post} store={store} /></MemoryRouter>);
    const img = screen.getByRole('img', { name: 'Mapa com praça e rio' });
    expect(img).toHaveAttribute('src', '/api/midia/77');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(screen.getByRole('link', { name: 'Abrir imagem: Mapa com praça e rio' })).toHaveAttribute('href', '/api/midia/77');
    await userEvent.click(screen.getByText('Descrição'));
    expect(screen.getAllByText('Mapa com praça e rio').length).toBeGreaterThan(0);
  });
});
