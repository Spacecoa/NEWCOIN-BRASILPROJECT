import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db.js';
import { encodePng, pngChunk } from '../src/lib/png.js';
import { MEDIA } from '../src/services/media.js';
import { api, asReader, post, resetDb, signup } from './helpers.js';

const png = (w = 40, h = 20, extra = []) => encodePng(w, h, (x, y) => [x * 6, y * 12, 160], extra);
const upload = (who, bytes, type = 'image/png') => {
  const r = api().post('/api/midia').set('Content-Type', type).send(bytes);
  return who ? r.set(who.auth) : r;
};
const withImage = async (who, text = 'post com imagem', alt = 'Gráfico de barras azul') => {
  const m = (await upload(who, png())).body.data;
  const res = await api().post('/api/posts').set(who.auth).send({ text, media: [{ id: m.id, alt }] });
  return { m, res };
};

describe('imagens nos posts', () => {
  let ana, bruno;
  beforeEach(async () => {
    await resetDb();
    [ana, bruno] = await Promise.all([signup('ana'), signup('bruno')]);
  });

  it('envio exige login; tira a localização e devolve id, tipo e dimensões', async () => {
    expect((await upload(null, png())).status).toBe(401);
    const res = await upload(ana, png(40, 20, [pngChunk('tEXt', Buffer.from('GPS\0-23.5505,-46.6333', 'latin1'))]));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ type: 'image/png', width: 40, height: 20 });
    const { rows } = await query('SELECT bytes FROM media WHERE id = $1', [res.body.data.id]);
    expect(rows[0].bytes.toString('latin1')).not.toContain('GPS');
  });

  it('o tipo vem dos bytes: SVG ou HTML com cabeçalho de imagem é recusado', async () => {
    const svg = await upload(ana, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'image/png');
    expect(svg.status).toBe(400);
    expect(svg.body.error).toMatch(/JPEG, PNG ou WebP/);
    expect((await upload(ana, Buffer.from('<html><script>x</script>'), 'image/jpeg')).status).toBe(400);
  });

  it('limites: tamanho, dimensões e imagens esperando um post', async () => {
    const big = await upload(ana, Buffer.concat([png(), Buffer.alloc(MEDIA.maxBytes)]));
    expect(big.status).toBe(413);
    expect(big.body.error).toMatch(/2 MB/);
    const huge = await upload(ana, encodePng(5000, 1, () => [0, 0, 0]));
    expect(huge.status).toBe(400);
    expect(huge.body.error).toMatch(/4096 px/);
    for (let i = 0; i < MEDIA.pendingPerUser; i++) expect((await upload(ana, png())).status).toBe(201);
    expect((await upload(ana, png())).status).toBe(409);
  });

  it('post com imagem: descrição obrigatória, até 4, e aparece no post com a descrição', async () => {
    const m = (await upload(ana, png())).body.data;
    expect((await api().post('/api/posts').set(ana.auth).send({ text: 'sem descrição', media: [{ id: m.id, alt: '  ' }] })).status).toBe(400);
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await upload(bruno, png())).body.data.id);
    expect((await api().post('/api/posts').set(bruno.auth).send({ text: 'cinco', media: ids.map((id) => ({ id, alt: 'x' })) })).status).toBe(400);

    const res = await api().post('/api/posts').set(ana.auth).send({ text: 'horta do bairro', media: [{ id: m.id, alt: 'Canteiro com alfaces e couves' }] });
    expect(res.status).toBe(201);
    expect(res.body.data.media).toEqual([{ id: m.id, type: 'photo', url: `/api/midia/${m.id}`, mime: 'image/png', width: 40, height: 20, alt: 'Canteiro com alfaces e couves' }]);
    // Visitante lê o post com a imagem; repost e timeline trazem a imagem do original.
    expect((await api().get(`/api/posts/${res.body.data.id}`)).body.data.media).toHaveLength(1);
    await api().post(`/api/posts/${res.body.data.id}/repost`).set(bruno.auth);
    const tl = (await api().get('/api/timeline').set(bruno.auth)).body;
    expect(tl.includes.posts.find((p) => p.id === res.body.data.id)?.media[0]?.alt).toBe('Canteiro com alfaces e couves');
  });

  it('só dá para anexar imagem própria, uma vez', async () => {
    const m = (await upload(ana, png())).body.data;
    expect((await api().post('/api/posts').set(bruno.auth).send({ text: 'roubando', media: [{ id: m.id, alt: 'x' }] })).status).toBe(400);
    expect((await api().post('/api/posts').set(ana.auth).send({ text: 'primeira', media: [{ id: m.id, alt: 'x' }] })).status).toBe(201);
    expect((await api().post('/api/posts').set(ana.auth).send({ text: 'de novo', media: [{ id: m.id, alt: 'x' }] })).status).toBe(400);
  });

  it('serve a imagem com tipo certo e cabeçalhos fechados; pendente, removida ou de suspensa não é servida', async () => {
    const pending = (await upload(ana, png())).body.data;
    expect((await api().get(pending.url)).status).toBe(404);
    const { m, res } = await withImage(ana);
    const img = await api().get(m.url).buffer(true);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    expect(img.headers['content-security-policy']).toMatch(/sandbox/);
    expect(img.body.subarray(1, 4).toString()).toBe('PNG');

    await query('UPDATE posts SET removed_at = now() WHERE id = $1', [res.body.data.id]);
    expect((await api().get(m.url)).status).toBe(404);
    await query('UPDATE posts SET removed_at = NULL WHERE id = $1', [res.body.data.id]);
    await query('UPDATE users SET suspended_at = now() WHERE id = $1', [ana.user.id]);
    expect((await api().get(m.url)).status).toBe(404);
  });

  it('apagar o post apaga a imagem; a federação manda a imagem com a descrição', async () => {
    const { m, res } = await withImage(ana, 'para a federação', 'Mapa do bairro');
    const out = (await api().get('/federation/users/ana/outbox')).body;
    expect(out.orderedItems[0].object.attachment).toEqual([expect.objectContaining({ type: 'Document', mediaType: 'image/png', name: 'Mapa do bairro', url: expect.stringMatching(new RegExp(`/api/midia/${m.id}$`)) })]);
    await api().delete(`/api/posts/${res.body.data.id}`).set(ana.auth);
    expect((await query('SELECT count(*)::int AS n FROM media WHERE id = $1', [m.id])).rows[0].n).toBe(0);
  });

  it('post sem imagem continua igual (media vazio)', async () => {
    const p = await post(ana, 'só texto');
    expect(p.media).toEqual([]);
    expect((await api().get(`/api/posts/${p.id}`).set(await asReader())).body.data.media).toEqual([]);
  });
});
