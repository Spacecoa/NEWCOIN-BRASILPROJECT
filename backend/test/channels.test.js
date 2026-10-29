import { beforeEach, describe, expect, it } from 'vitest';
import { api, resetDb, signup } from './helpers.js';

describe('canais e grupos (vertente Telegram)', () => {
  let owner, member, outsider;
  beforeEach(async () => {
    await resetDb();
    [owner, member, outsider] = await Promise.all([signup('dona'), signup('membro'), signup('visitante')]);
  });

  const create = (who, body) => api().post('/api/channels').set(who.auth).send(body);
  const send = (who, slug, text) => api().post(`/api/channels/${slug}/messages`).set(who.auth).send({ text });

  it('canal de broadcast: só owner/admin publicam', async () => {
    const res = await create(owner, { slug: 'avisos', title: 'Avisos', kind: 'channel' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ viewer_role: 'owner', member_count: 1, pts: 0 });

    await api().post('/api/channels/avisos/members').set(member.auth);
    expect((await send(member, 'avisos', 'posso?')).status).toBe(403);
    expect((await send(outsider, 'avisos', 'e eu?')).status).toBe(403);
    expect((await send(owner, 'avisos', 'comunicado')).status).toBe(201);

    // promovido a admin, passa a publicar
    await api().put('/api/channels/avisos/members/membro/role').set(owner.auth).send({ role: 'admin' });
    expect((await send(member, 'avisos', 'agora sim')).status).toBe(201);
    expect((await api().put('/api/channels/avisos/members/dona/role').set(member.auth).send({ role: 'member' })).status).toBe(403);
  });

  it('grupo: membros publicam; pts é sequencial e /difference recupera lacunas', async () => {
    await create(owner, { slug: 'grupo', title: 'Grupo', kind: 'group' });
    await api().post('/api/channels/grupo/members').set(member.auth);
    const sent = [];
    for (let i = 1; i <= 5; i++) sent.push((await send(i % 2 ? owner : member, 'grupo', `m${i}`)).body.data);
    expect(sent.map((m) => m.pts)).toEqual([1, 2, 3, 4, 5]);

    const diff = await api().get('/api/channels/grupo/difference?pts=3').set(member.auth);
    expect(diff.body.data.map((m) => m.text)).toEqual(['m4', 'm5']);
    expect(diff.body.meta).toEqual({ pts: 5, too_long: false });

    // Grupo é só de quem entrou (docs/14, C-1).
    expect((await api().get('/api/channels/grupo/messages').set(outsider.auth)).status).toBe(403);
    const hist = await api().get('/api/channels/grupo/messages?max_results=2').set(member.auth);
    expect(hist.body.data.map((m) => m.text)).toEqual(['m5', 'm4']);
    const older = await api().get(`/api/channels/grupo/messages?max_results=2&until_id=${hist.body.meta.next_token}`).set(owner.auth);
    expect(older.body.data.map((m) => m.text)).toEqual(['m3', 'm2']);
  });

  it('pts permanece sem buracos sob envio concorrente', async () => {
    await create(owner, { slug: 'corrida', title: 'Corrida', kind: 'group' });
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => send(owner, 'corrida', `c${i}`)));
    const pts = results.map((r) => r.body.data.pts).sort((a, b) => a - b);
    expect(pts).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('reações agregam por emoji e marcam a do viewer', async () => {
    await create(owner, { slug: 'reage', title: 'Reage', kind: 'channel' });
    await api().post('/api/channels/reage/members').set(member.auth);
    const msg = (await send(owner, 'reage', 'reaja!')).body.data;
    const url = `/api/channels/reage/messages/${msg.id}/reactions`;
    await api().post(url).set(owner.auth).send({ emoji: '🔥' });
    await api().post(url).set(member.auth).send({ emoji: '🔥' });
    const r = await api().post(url).set(member.auth).send({ emoji: '👍' });
    expect(r.body.data.reactions).toEqual([
      { emoji: '🔥', count: 2, reacted: true },
      { emoji: '👍', count: 1, reacted: true },
    ]);
    expect((await api().post(url).set(outsider.auth).send({ emoji: '👍' })).status).toBe(403);
    const removed = await api().delete(`${url}/${encodeURIComponent('🔥')}`).set(member.auth);
    expect(removed.body.data.reactions[0]).toEqual({ emoji: '🔥', count: 1, reacted: false });
  });

  it('valida slug duplicado e o dono não pode sair', async () => {
    await create(owner, { slug: 'unico', title: 'Único', kind: 'group' });
    expect((await create(member, { slug: 'UNICO', title: 'x', kind: 'group' })).status).toBe(409);
    expect((await create(member, { slug: 'x', title: 'x', kind: 'group' })).status).toBe(400);
    expect((await api().delete('/api/channels/unico/members/me').set(owner.auth)).status).toBe(409);
    await api().post('/api/channels/unico/members').set(member.auth);
    const left = await api().delete('/api/channels/unico/members/me').set(member.auth);
    expect(left.body.data).toMatchObject({ viewer_role: null, member_count: 1 });
  });
});
