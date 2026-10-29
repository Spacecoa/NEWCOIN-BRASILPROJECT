import { call, check, eq, follow, getPost, mod, post, reg, rules, sleep, socket, sql, state, status, sim, waitFor } from './lib.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const shared = await import(new URL('../../shared/ranking/ranking.js', import.meta.url));
const { rank, mergeSettings, decayed, learn, LEARNING, FACTORS, DEFAULT_SETTINGS } = shared;

// ---------------------------------------------------------------- Algoritmo aberto (no aparelho)
sim('Algoritmo "Para você"', 'Especificação pública do algoritmo: 5 fatores, popularidade em zero, código-fonte aberto', 'docs/07, README', async () => {
  const r = await call(null, 'GET', '/api/feed/algoritmo');
  status(r, 200, 'sem login');
  eq(r.j.factors.map((f) => f.id).sort(), ['descoberta', 'interesse', 'pessoas', 'popularidade', 'recencia'], 'fatores');
  eq(r.j.factors.find((f) => f.id === 'popularidade').peso_padrao, 0, 'peso padrão da popularidade');
  eq(r.j.defaults.weights.popularidade, 0, 'popularidade padrão');
  eq(r.j.codigo_fonte, 'shared/ranking/ranking.js', 'código-fonte');
  check(r.j.learning.nao_usa.includes('tempo de tela'), 'o algoritmo deveria declarar que não usa tempo de tela');
  check(Math.abs(Object.values(r.j.defaults.weights).reduce((a, b) => a + b, 0) - 1) < 1e-9, 'os pesos padrão deveriam somar 1');
  check(/aparelho/.test(r.j.onde ?? ''), 'a especificação deveria dizer que o algoritmo fica no aparelho');
});

sim('Algoritmo "Para você"', 'Candidatos: só com login, sem os próprios posts nem reposts, com quem a pessoa segue', 'docs/07 §2.10', async () => {
  const a = await reg('cd');
  const b = await reg('cd');
  const c = await reg('cd');
  status(await call(null, 'GET', '/api/feed/candidatos'), 401, 'sem login');
  const pb = await post(b, 'post da B sobre Postgres');
  await post(a, 'post da própria A');
  await call(c.tok, 'POST', `/api/posts/${pb.id}/repost`);
  await follow(a, b.u);
  await call(a.tok, 'POST', `/api/posts/${pb.id}/like`);
  const r = await call(a.tok, 'GET', '/api/feed/candidatos');
  status(r, 200, 'candidatos');
  const ids = r.j.data.map((p) => p.id);
  check(ids.includes(pb.id), 'o post da B deveria ser candidato');
  check(r.j.data.every((p) => p.author_id !== a.id), 'os próprios posts não podem ser candidatos');
  check(r.j.data.every((p) => p.referenced_posts.every((x) => x.type !== 'reposted')), 'reposts não podem ser candidatos');
  check(r.j.meta.following.includes(b.id), 'meta.following deveria trazer quem a pessoa segue');
  eq([r.j.meta.window_days, r.j.meta.limit, r.j.meta.algorithm], [7, 500, 'interesses-v1'], 'janela, limite e versão');
  eq(r.j.data.find((p) => p.id === pb.id).viewer.liked, true, 'estado do viewer nos candidatos');
});

sim('Algoritmo "Para você"', 'O servidor não calcula o feed: /feed/interesses responde 410 e aponta para os candidatos', 'docs/07 §2.10 (documento 03 §4 ainda lista a rota)', async () => {
  const a = await reg('gone');
  status(await call(null, 'GET', '/api/feed/interesses'), 401, 'sem login');
  const r = await call(a.tok, 'GET', '/api/feed/interesses');
  status(r, 410, 'rota antiga');
  check(/candidatos/.test(r.j.error) && /aparelho/.test(r.j.error), `a mensagem deveria orientar o uso: ${r.j.error}`);
  return { detail: '410 como documentado em docs/07', docNote: 'docs/03 §4 ainda descreve GET /api/feed/interesses como feed do servidor e PUT /api/feed/modo com "server"' };
});

sim('Algoritmo "Para você"', 'O servidor só guarda missões e contagem de tempo; qualquer campo do algoritmo é recusado', 'docs/07 §2.10', async () => {
  const a = await reg('pr');
  const g = await call(a.tok, 'GET', '/api/feed/preferencias');
  status(g, 200, 'GET');
  eq(g.j.settings.ranking_mode, 'device', 'modo de uma conta nova');
  eq(g.j.learned, { topics: [], authors: [] }, 'aprendizado no servidor');
  const ok = await call(a.tok, 'PUT', '/api/feed/preferencias', { missions_enabled: false, count_time: false });
  status(ok, 200, 'PUT permitido');
  eq([ok.j.settings.missions_enabled, ok.j.settings.count_time], [false, false], 'valores gravados');
  for (const body of [{ topics: { frontend: 1 } }, { weights: { interesse: 1 } }, { keywords: ['x'] }, { muted_topics: ['infra'] }, { session_limit: 10 }, { ranking_mode: 'server' }, { campo_novo: 1 }]) {
    check((await call(a.tok, 'PUT', '/api/feed/preferencias', body)).s === 400, `${Object.keys(body)[0]} deveria ser recusado`);
  }
  status(await call(a.tok, 'DELETE', '/api/feed/aprendizado'), 200, 'apagar aprendizado');
});

sim('Algoritmo "Para você"', 'Curtir, repostar, responder e "menos disto" não deixam rastro de aprendizado no servidor', 'docs/07 §2.10', async () => {
  const a = await reg('nl');
  const b = await reg('nl');
  const p = await post(b, 'Cache Redis na prática');
  await call(a.tok, 'POST', `/api/posts/${p.id}/like`);
  await call(a.tok, 'POST', `/api/posts/${p.id}/repost`);
  await post(a, 'Redis ajuda muito', p.id);
  const fb = await call(a.tok, 'POST', `/api/posts/${p.id}/feedback`, { kind: 'less' });
  status(fb, 200, 'feedback');
  eq(fb.j, { ok: true, kind: 'less', stored: false }, 'resposta do feedback');
  status(await call(a.tok, 'POST', `/api/posts/${p.id}/feedback`, { kind: 'talvez' }), 400, 'sinal inválido');
  const g = (await call(a.tok, 'GET', '/api/feed/preferencias')).j;
  eq([g.learned, g.hidden_post_ids], [{ topics: [], authors: [] }, []], 'o servidor não pode ter guardado nada');
  for (const t of ['learned_topics', 'learned_authors', 'hidden_posts']) eq(sql(`SELECT count(*) FROM ${t} WHERE user_id = ${a.id}`), '0', `linhas em ${t}`);
});

sim('Algoritmo "Para você"', 'Conta antiga: levar o algoritmo ao aparelho apaga a cópia do servidor e mantém missões e tempo', 'docs/07 §2.10 (contas antigas)', async () => {
  const a = await reg('lg');
  const b = await reg('lg');
  const p = await post(b, 'Postgres e cache');
  sql(`INSERT INTO feed_settings (user_id, settings) VALUES (${a.id}, '{"ranking_mode":"server","topics":{"bancos":1},"keywords":["redis"],"missions_enabled":false,"count_time":false}') ON CONFLICT (user_id) DO UPDATE SET settings = EXCLUDED.settings`);
  sql(`INSERT INTO learned_topics (user_id, topic, value) VALUES (${a.id}, 'bancos', 0.3)`);
  sql(`INSERT INTO hidden_posts (user_id, post_id) VALUES (${a.id}, ${p.id})`);
  const before = (await call(a.tok, 'GET', '/api/feed/preferencias')).j;
  eq(before.settings.ranking_mode, 'server', 'a conta antiga ainda aparece como "server"');
  check(before.learned.topics.length === 1 && before.hidden_post_ids.length === 1, 'o app precisa receber o que o servidor tinha para importar');
  status(await call(a.tok, 'PUT', '/api/feed/modo', { mode: 'server' }), 400, 'voltar ao servidor');
  status(await call(a.tok, 'PUT', '/api/feed/modo', { mode: 'device', extra: 1 }), 400, 'campo extra');
  const r = await call(a.tok, 'PUT', '/api/feed/modo', { mode: 'device' });
  status(r, 200, 'levar para o aparelho');
  const after = (await call(a.tok, 'GET', '/api/feed/preferencias')).j;
  eq([after.settings.ranking_mode, after.settings.topics, after.settings.keywords], ['device', {}, []], 'preferências do algoritmo apagadas');
  eq([after.settings.missions_enabled, after.settings.count_time], [false, false], 'missões e tempo preservados');
  eq([after.learned, after.hidden_post_ids], [{ topics: [], authors: [] }, []], 'aprendizado e escondidos apagados');
});

sim('Algoritmo "Para você"', 'Ranking local (mesmo código do navegador): tópico declarado sobe, silenciado some, palavra-chave e explicação somam a nota', 'docs/07 §2 (nota = soma das contribuições)', async () => {
  const now = Date.now();
  const mk = (id, text, extra = {}) => ({ id, author_id: extra.author ?? id, text, created_at: new Date(now - 3600_000).toISOString(), like_count: extra.likes ?? 0, repost_count: 0 });
  const rows = [mk('101', 'Componente React acessível'), mk('102', 'Postgres com índices parciais'), mk('103', 'Deploy no Kubernetes'), mk('104', 'Aula sobre federação e WebFinger')];
  const run = (settings, learned = {}) => rank(rows, { settings: mergeSettings(settings), following: new Set(), learnedTopics: learned, learnedAuthors: {} });
  const tuned = run({ topics: { frontend: 1 }, muted_topics: ['infra'] });
  eq(tuned[0].post.id, '101', 'o tópico declarado deveria vir primeiro');
  check(!tuned.some((r) => r.post.id === '103'), 'o tópico silenciado não pode aparecer');
  eq(run({ keywords: ['webfinger'] })[0].post.id, '104', 'palavra-chave');
  const r0 = tuned[0];
  const soma = r0.reasons.reduce((s, x) => s + x.contribuicao, 0);
  check(Math.abs(soma - r0.score) < 0.011, `a nota (${r0.score}) deveria ser a soma das contribuições (${soma})`);
  eq(r0.reasons.map((x) => x.fator).sort(), ['descoberta', 'interesse', 'pessoas', 'popularidade', 'recencia'], 'fatores explicados');
  const viral = rank([mk('201', 'Texto neutro igual', { likes: 1000 }), mk('202', 'Texto neutro igual', { likes: 0 })], { settings: mergeSettings({}), following: new Set(), learnedTopics: {}, learnedAuthors: {} });
  eq(viral[0].score, viral[1].score, 'com popularidade em zero, curtidas não mudam a nota');
});

sim('Algoritmo "Para você"', 'Aprendizado: sinais do documento, meia-vida de 14 dias e limites', 'docs/07 §2.6', async () => {
  eq(LEARNING.signals, { like: 0.15, unlike: -0.15, repost: 0.25, reply: 0.3, more: 0.3, less: -0.5 }, 'valores dos sinais');
  eq(LEARNING.half_life_days, 14, 'meia-vida');
  check(Math.abs(decayed(0.8, new Date(Date.now() - 14 * 86_400_000)) - 0.4) < 0.01, 'o valor deveria cair à metade em 14 dias');
  eq(learn(0.95, new Date(), 'reply'), 1, 'limite superior');
  eq(learn(-0.9, new Date(), 'less'), -1, 'limite inferior');
  let threw = false;
  try {
    learn(0, new Date(), 'tempo_de_tela');
  } catch {
    threw = true;
  }
  check(threw, 'um sinal desconhecido (como tempo de tela) deveria ser recusado');
  eq(DEFAULT_SETTINGS.session_limit, 40, 'limite de sessão padrão');
});

// ---------------------------------------------------------------- Canais e grupos
const mkChan = (who, kind, slugPart = 'c') => call(who.tok, 'POST', '/api/channels', { slug: `${slugPart}${Math.random().toString(36).slice(2, 9)}`, title: `Espaço ${kind}`, kind });

sim('Canais e grupos', 'Criar canal e grupo: papel de dono, slug validado e único sem diferenciar maiúsculas', 'docs/02, docs/03 §4', async () => {
  const a = await reg('ch');
  const slug = 'sala' + Math.random().toString(36).slice(2, 8);
  const r = await call(a.tok, 'POST', '/api/channels', { slug, title: 'Sala de teste', kind: 'group' });
  status(r, 201, 'criar');
  eq([r.j.data.viewer_role, r.j.data.pts, r.j.data.member_count, r.j.data.kind], ['owner', 0, 1, 'group'], 'canal recém-criado');
  for (const bad of [{ slug: 'ab' }, { slug: 'com espaço' }, { slug: 'x'.repeat(33) }, { kind: 'sala' }, { title: '' }]) check((await call(a.tok, 'POST', '/api/channels', { slug: 'ok' + Math.random().toString(36).slice(2, 8), title: 'T', kind: 'group', ...bad })).s === 400, `${Object.keys(bad)[0]} inválido deveria dar 400`);
  status(await call(a.tok, 'POST', '/api/channels', { slug: slug.toUpperCase(), title: 'outra', kind: 'group' }), 409, 'slug repetido');
  const list = await call(a.tok, 'GET', '/api/channels');
  check(list.j.data.some((c) => c.slug === slug), 'a lista deveria trazer o canal criado');
});

sim('Canais e grupos', 'Canal de transmissão: só dono e admins publicam; membro e visitante não', 'docs/02 (broadcast), docs/03', async () => {
  const dona = await reg('bc');
  const m = await reg('bc');
  const adm = await reg('bc');
  const ch = (await mkChan(dona, 'channel')).j.data;
  const msg = (w, t = 'aviso') => call(w.tok, 'POST', `/api/channels/${ch.slug}/messages`, { text: t });
  status(await msg(m), 403, 'quem nunca entrou');
  await call(m.tok, 'POST', `/api/channels/${ch.slug}/members`);
  status(await msg(m), 403, 'membro comum');
  status(await msg(dona), 201, 'dono');
  await call(adm.tok, 'POST', `/api/channels/${ch.slug}/members`);
  status(await call(dona.tok, 'PUT', `/api/channels/${ch.slug}/members/${adm.u}/role`, { role: 'admin' }), 200, 'promover');
  status(await msg(adm, 'aviso do admin'), 201, 'admin');
  const h = await call(m.tok, 'GET', `/api/channels/${ch.slug}/messages`);
  status(h, 200, 'membro lê o canal');
  eq(h.j.data.length, 2, 'mensagens do canal');
});

sim('Canais e grupos', 'Grupo: todos os membros publicam, não-membro não, limites de tamanho', 'docs/02, docs/03', async () => {
  const dona = await reg('gp');
  const m = await reg('gp');
  const fora = await reg('gp');
  const ch = (await mkChan(dona, 'group')).j.data;
  await call(m.tok, 'POST', `/api/channels/${ch.slug}/members`);
  const msg = (w, t) => call(w.tok, 'POST', `/api/channels/${ch.slug}/messages`, { text: t });
  status(await msg(m, 'oi, sou membro'), 201, 'membro');
  status(await msg(fora, 'oi de fora'), 403, 'não-membro');
  status(await msg(dona, 'a'.repeat(4096)), 201, '4096 caracteres');
  status(await msg(dona, 'a'.repeat(4097)), 400, '4097 caracteres');
  status(await msg(dona, '   '), 400, 'mensagem vazia');
});

sim('Canais e grupos', 'pts sequencial e sem buracos mesmo com 10 mensagens ao mesmo tempo', 'docs/02 (pts), docs/03', async () => {
  const a = await reg('pt');
  const ch = (await mkChan(a, 'group')).j.data;
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => call(a.tok, 'POST', `/api/channels/${ch.slug}/messages`, { text: `m${i}` })));
  for (const r of rs) status(r, 201, 'mensagem concorrente');
  eq(rs.map((r) => r.j.data.pts).sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'pts');
  eq((await call(a.tok, 'GET', `/api/channels/${ch.slug}`)).j.data.pts, 10, 'pts do canal');
});

sim('Canais e grupos', '/difference devolve só o que falta; lacuna grande pede recarregar (too_long)', 'README (exemplo difference), docs/02', async () => {
  const a = await reg('df');
  const ch = (await mkChan(a, 'group')).j.data;
  const say = (n) => Promise.all(Array.from({ length: n }, (_, i) => call(a.tok, 'POST', `/api/channels/${ch.slug}/messages`, { text: `m${i}` })));
  await say(5);
  const d = await call(a.tok, 'GET', `/api/channels/${ch.slug}/difference?pts=3`);
  status(d, 200, 'difference');
  eq(d.j.data.map((m) => m.pts), [4, 5], 'mensagens com pts > 3, em ordem crescente');
  eq(d.j.meta, { pts: 5, too_long: false }, 'meta');
  await say(100);
  const big = await call(a.tok, 'GET', `/api/channels/${ch.slug}/difference?pts=0`);
  eq([big.j.data.length, big.j.meta.too_long], [100, true], 'lacuna de 105 mensagens');
  status(await call(a.tok, 'GET', `/api/channels/${ch.slug}/difference?pts=-1`), 400, 'pts negativo');
});

sim('Canais e grupos', 'Histórico paginado: mais recentes primeiro, cursor sem repetição', 'docs/02 (getHistory), docs/03', async () => {
  const a = await reg('hs');
  const ch = (await mkChan(a, 'group')).j.data;
  for (let i = 1; i <= 5; i++) await call(a.tok, 'POST', `/api/channels/${ch.slug}/messages`, { text: `m${i}` });
  const p1 = await call(a.tok, 'GET', `/api/channels/${ch.slug}/messages?max_results=2`);
  eq(p1.j.data.map((m) => m.text), ['m5', 'm4'], 'primeira página');
  const p2 = await call(a.tok, 'GET', `/api/channels/${ch.slug}/messages?max_results=2&until_id=${p1.j.meta.next_token}`);
  eq(p2.j.data.map((m) => m.text), ['m3', 'm2'], 'segunda página');
  eq(p1.j.meta.pts, 5, 'pts na meta');
});

sim('Canais e grupos', 'Reações: só emojis da lista, até 3 por pessoa, agregação e remoção', 'docs/14 C-3', async () => {
  const a = await reg('rc');
  const b = await reg('rc');
  const ch = (await mkChan(a, 'group')).j.data;
  await call(b.tok, 'POST', `/api/channels/${ch.slug}/members`);
  const m = (await call(a.tok, 'POST', `/api/channels/${ch.slug}/messages`, { text: 'reaja' })).j.data;
  const url = `/api/channels/${ch.slug}/messages/${m.id}/reactions`;
  status(await call(a.tok, 'POST', url, { emoji: 'texto livre' }), 400, 'texto livre');
  for (const e of ['👍', '❤️', '🔥']) status(await call(a.tok, 'POST', url, { emoji: e }), 200, `reação ${e}`);
  status(await call(a.tok, 'POST', url, { emoji: '😂' }), 409, '4ª reação diferente');
  status(await call(a.tok, 'POST', url, { emoji: '👍' }), 200, 'repetir a mesma');
  await call(b.tok, 'POST', url, { emoji: '👍' });
  const v = (await call(b.tok, 'GET', `/api/channels/${ch.slug}/messages`)).j.data[0].reactions;
  eq(v.find((x) => x.emoji === '👍'), { emoji: '👍', count: 2, reacted: true }, 'contagem vista pela B');
  const del = await call(b.tok, 'DELETE', `${url}/${encodeURIComponent('👍')}`);
  status(del, 200, 'remover reação');
  eq(del.j.data.reactions.find((x) => x.emoji === '👍').count, 1, 'contagem depois de remover');
});

sim('Canais e grupos', 'Papéis: dono promove e rebaixa admins; ninguém muda o dono; dono não sai; membro sai e perde o acesso', 'docs/02, docs/03 §4', async () => {
  const dona = await reg('rl');
  const m = await reg('rl');
  const x = await reg('rl');
  const ch = (await mkChan(dona, 'group')).j.data;
  for (const w of [m, x]) await call(w.tok, 'POST', `/api/channels/${ch.slug}/members`);
  const role = (who, target, r) => call(who.tok, 'PUT', `/api/channels/${ch.slug}/members/${target}/role`, { role: r });
  status(await role(m, x.u, 'admin'), 403, 'membro promovendo');
  status(await role(dona, m.u, 'admin'), 200, 'dono promovendo');
  status(await role(m, x.u, 'admin'), 403, 'admin promovendo (só o dono pode)');
  status(await role(dona, dona.u, 'member'), 404, 'mudar o papel do dono');
  status(await role(dona, m.u, 'member'), 200, 'rebaixar');
  status(await role(dona, m.u, 'chefe'), 400, 'papel inválido');
  status(await call(dona.tok, 'DELETE', `/api/channels/${ch.slug}/members/me`), 409, 'dono saindo');
  const out = await call(m.tok, 'DELETE', `/api/channels/${ch.slug}/members/me`);
  status(out, 200, 'membro saindo');
  eq(out.j.data.viewer_role, null, 'papel depois de sair');
  status(await call(m.tok, 'GET', `/api/channels/${ch.slug}/messages`), 403, 'ler o grupo depois de sair');
});

sim('Canais e grupos', 'Remover e banir: admin remove membro, banido não entra, desfazer a remoção libera', 'docs/14 C-2', async () => {
  const dona = await reg('bn');
  const adm = await reg('bn');
  const adm2 = await reg('bn');
  const chato = await reg('bn');
  const ch = (await mkChan(dona, 'group')).j.data;
  for (const w of [adm, adm2, chato]) await call(w.tok, 'POST', `/api/channels/${ch.slug}/members`);
  for (const w of [adm, adm2]) await call(dona.tok, 'PUT', `/api/channels/${ch.slug}/members/${w.u}/role`, { role: 'admin' });
  const del = (who, t) => call(who.tok, 'DELETE', `/api/channels/${ch.slug}/members/${t}`);
  status(await del(chato, adm.u), 403, 'membro removendo');
  status(await del(adm, adm2.u), 403, 'admin removendo admin');
  status(await del(adm, dona.u), 403, 'admin removendo o dono');
  status(await del(dona, dona.u), 409, 'dono removendo a si mesmo');
  status(await del(adm, chato.u), 200, 'admin removendo membro');
  status(await call(chato.tok, 'GET', `/api/channels/${ch.slug}/messages`), 403, 'removido lendo');
  status(await call(chato.tok, 'POST', `/api/channels/${ch.slug}/members`), 403, 'removido entrando de novo');
  status(await call(adm.tok, 'DELETE', `/api/channels/${ch.slug}/bans/${chato.u}`), 200, 'desfazer remoção');
  status(await call(chato.tok, 'POST', `/api/channels/${ch.slug}/members`), 200, 'entrar depois de desfeito');
});

sim('Canais e grupos', 'Grupo é só de quem entrou; canal de transmissão tem prévia para quem está logado', 'docs/14 C-1, README', async () => {
  const a = await reg('fc');
  const fora = await reg('fc');
  const g = (await mkChan(a, 'group')).j.data;
  const c = (await mkChan(a, 'channel')).j.data;
  await call(a.tok, 'POST', `/api/channels/${g.slug}/messages`, { text: 'conversa interna' });
  await call(a.tok, 'POST', `/api/channels/${c.slug}/messages`, { text: 'aviso público' });
  status(await call(fora.tok, 'GET', `/api/channels/${g.slug}/messages`), 403, 'histórico do grupo');
  status(await call(fora.tok, 'GET', `/api/channels/${g.slug}/difference?pts=0`), 403, 'difference do grupo');
  status(await call(fora.tok, 'GET', `/api/channels/${g.slug}`), 200, 'detalhes do grupo (nome e membros)');
  status(await call(fora.tok, 'GET', `/api/channels/${c.slug}/messages`), 200, 'prévia do canal');
  status(await call(null, 'GET', `/api/channels/${c.slug}/messages`), 401, 'visitante');
});

sim('Tempo real', 'Mensagem chega ao vivo a quem assinou; quem não é membro não assina o grupo; cancelar a assinatura para os eventos', 'docs/03 (Socket.io), docs/14 C-1', async () => {
  const a = await reg('ws');
  const b = await reg('ws');
  const fora = await reg('ws');
  const ch = (await mkChan(a, 'group')).j.data;
  await call(b.tok, 'POST', `/api/channels/${ch.slug}/members`);
  const sb = await socket(b);
  const sf = await socket(fora);
  try {
    const ack = await sb.emitWithAck('channel:subscribe', { slug: ch.slug });
    eq(ack, { ok: true, pts: 0 }, 'ack da assinatura');
    const nope = await sf.emitWithAck('channel:subscribe', { slug: ch.slug });
    check(nope.ok === false, 'não-membro não pode assinar o grupo');
    const t0 = Date.now();
    await call(a.tok, 'POST', `/api/channels/${ch.slug}/messages`, { text: 'ao vivo' });
    const ev = await waitFor(() => sb.events.find((e) => e.ev === 'message:new'));
    check(ev && ev.p.data.text === 'ao vivo' && ev.p.data.pts === 1, 'a mensagem não chegou ao vivo');
    check(Date.now() - t0 < 1500, `demorou ${Date.now() - t0} ms`);
    await sleep(150);
    check(!sf.events.some((e) => e.ev === 'message:new'), 'quem não é membro recebeu a mensagem');
    sb.emit('channel:unsubscribe', { slug: ch.slug });
    await sleep(150);
    sb.events.length = 0;
    await call(a.tok, 'POST', `/api/channels/${ch.slug}/messages`, { text: 'depois de sair da sala' });
    await sleep(300);
    check(!sb.events.some((e) => e.ev === 'message:new'), 'recebeu mensagem depois de cancelar a assinatura');
  } finally {
    sb.close();
    sf.close();
  }
  return 'entrega em menos de 1,5 s';
});

sim('Tempo real', 'Conexão exige token válido e no máximo 10 conexões por conta', 'docs/14 C-4', async () => {
  const a = await reg('wl');
  let rejected = false;
  try {
    const s = await socket({ tok: 'token-lixo' });
    s.close();
  } catch (e) {
    rejected = /unauthorized/.test(e.message);
  }
  check(rejected, 'conexão sem token válido deveria ser recusada');
  const open = [];
  try {
    for (let i = 0; i < 10; i++) open.push(await socket(a));
    let msg = null;
    try {
      open.push(await socket(a));
    } catch (e) {
      msg = e.message;
    }
    eq(msg, 'too_many_connections', 'a 11ª conexão');
  } finally {
    open.forEach((s) => s.close());
  }
});

sim('Tempo real', 'Post novo chega a quem segue (timeline:new), menção e resposta geram notificação; quem não segue não recebe', 'README (tempo real), docs/03 §4', async () => {
  const a = await reg('rt');
  const b = await reg('rt');
  const c = await reg('rt');
  await follow(b, a.u);
  const sb = await socket(b);
  const sc = await socket(c);
  const sa = await socket(a);
  try {
    const p = await post(a, `olá @${c.u}`);
    const tl = await waitFor(() => sb.events.find((e) => e.ev === 'timeline:new'));
    check(tl && tl.p.data.id === p.id, 'a seguidora deveria receber timeline:new');
    const n = await waitFor(() => sc.events.find((e) => e.ev === 'notification'));
    check(n && n.p.type === 'mention', 'a pessoa mencionada deveria receber notificação de menção');
    await sleep(150);
    check(!sc.events.some((e) => e.ev === 'timeline:new' && e.p.data.id === p.id), 'quem não segue recebeu timeline:new');
    await post(b, 'respondendo', p.id);
    const rn = await waitFor(() => sa.events.find((e) => e.ev === 'notification' && e.p.type === 'reply'));
    check(rn, 'a autora deveria ser avisada da resposta');
  } finally {
    [sa, sb, sc].forEach((s) => s.close());
  }
});
