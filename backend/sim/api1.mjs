import { PASSWORD, call, check, eq, follow, getPost, login, mod, post, reg, rules, sleep, sql, state, status } from './lib.mjs';
import { sim } from './lib.mjs';

// ---------------------------------------------------------------- Contas e sessão
sim('Contas e sessão', 'Cadastro aceitando as regras: token de 15 min, cookie protegido e handle federado', 'docs/03 §4, docs/10 A2, docs/12', async () => {
  const username = 'cad' + Math.random().toString(36).slice(2, 8);
  const r = await call(null, 'POST', '/api/auth/register', { username, email: `${username}@sim.test`, password: PASSWORD, accept_rules: true, display_name: 'Pessoa Nova' });
  status(r, 201, 'cadastro');
  check(r.j.user.handle === `${username}@localhost:4020`, `handle: ${r.j.user.handle}`);
  check(r.j.user.is_moderator === false, 'conta nova não pode ser moderação');
  check(!('password_hash' in r.j.user) && !('email' in r.j.user), 'a resposta não pode expor senha nem e-mail');
  const payload = JSON.parse(Buffer.from(r.j.token.split('.')[1], 'base64url').toString());
  eq(payload.exp - payload.iat, 900, 'duração do token de acesso (s)');
  check(/HttpOnly/i.test(r.cookie) && /SameSite=Strict/i.test(r.cookie) && /Path=\/api\/auth/i.test(r.cookie), `cookie sem os atributos documentados: ${r.cookie}`);
  const me = await call(r.j.token, 'GET', '/api/auth/me');
  status(me, 200, '/me');
  return `usuário ${username}, token de ${payload.exp - payload.iat}s`;
});

sim('Contas e sessão', 'Cadastro sem aceitar as regras é recusado e não cria conta', 'docs/12 §3 (accept_rules obrigatório)', async () => {
  const u = 'sr' + Math.random().toString(36).slice(2, 8);
  const base = { username: u, email: `${u}@sim.test`, password: PASSWORD };
  status(await call(null, 'POST', '/api/auth/register', base), 400, 'sem accept_rules');
  status(await call(null, 'POST', '/api/auth/register', { ...base, accept_rules: false }), 400, 'accept_rules=false');
  status(await call(null, 'POST', '/api/auth/register', { ...base, accept_rules: 'true' }), 400, 'accept_rules como texto');
  status(await login(base.email), 401, 'a conta não pode ter sido criada');
});

sim('Contas e sessão', 'Campos inválidos e duplicidade (sem diferenciar maiúsculas) no cadastro', 'docs/03 §4, schema CITEXT', async () => {
  const ok = await reg('dup');
  const bad = (over) => call(null, 'POST', '/api/auth/register', { username: 'x' + Math.random().toString(36).slice(2, 8), email: `${Math.random().toString(36).slice(2)}@sim.test`, password: PASSWORD, accept_rules: true, ...over });
  for (const [label, over] of [['usuário curto', { username: 'ab' }], ['usuário com espaço', { username: 'com espaco' }], ['usuário com 21 caracteres', { username: 'a'.repeat(21) }], ['usuário com acento', { username: 'josé_x' }], ['e-mail inválido', { email: 'nao-e-email' }], ['senha de 7 caracteres', { password: '1234567' }], ['senha de 129 caracteres', { password: 'x'.repeat(129) }], ['nome de exibição vazio', { display_name: '' }]]) {
    const r = await bad(over);
    check(r.s === 400, `${label}: esperado 400, veio ${r.s}`);
    check(Array.isArray(r.j.details) && r.j.details.length > 0, `${label}: faltou dizer qual campo falhou`);
  }
  status(await bad({ username: ok.u.toUpperCase() }), 409, 'usuário repetido em maiúsculas');
  status(await bad({ email: ok.email.toUpperCase() }), 409, 'e-mail repetido em maiúsculas');
});

sim('Contas e sessão', 'Entrar por e-mail (qualquer caixa) e pelo usuário (legado); erro igual para senha errada e conta inexistente', 'docs/03 §4, docs/10 M3', async () => {
  const a = await reg('lg');
  status(await login(a.email), 200, 'e-mail');
  status(await login(a.email.toUpperCase()), 200, 'e-mail em maiúsculas');
  status(await call(null, 'POST', '/api/auth/login', { login: a.u, password: PASSWORD }), 200, 'login por usuário (legado)');
  const wrong = await login(a.email, 'senha-errada-1');
  const ghost = await login(`nao_existe_${Date.now()}@sim.test`, 'senha-errada-1');
  status(wrong, 401, 'senha errada');
  status(ghost, 401, 'conta inexistente');
  eq(wrong.j.error, ghost.j.error, 'a mensagem de erro tem de ser a mesma');
  status(await call(null, 'POST', '/api/auth/login', { email: 'sem-arroba', password: PASSWORD }), 400, 'e-mail malformado');
  status(await call(null, 'POST', '/api/auth/login', { password: PASSWORD }), 400, 'sem e-mail');
});

sim('Contas e sessão', 'Renovação pelo cookie: rotaciona o cookie e tolera a segunda aba na janela de 30 s', 'docs/10 A2 (refresh com rotação)', async () => {
  const a = await reg('rf');
  const r1 = await call(null, 'POST', '/api/auth/refresh', undefined, { headers: { cookie: a.cookie } });
  status(r1, 200, 'refresh');
  check(r1.j.token && r1.j.user.username === a.u, 'refresh sem token/usuário');
  const novo = r1.cookie.split(';')[0];
  check(novo && novo !== a.cookie, 'o cookie precisa ser trocado (rotação)');
  const r2 = await call(null, 'POST', '/api/auth/refresh', undefined, { headers: { cookie: a.cookie } });
  status(r2, 200, 'segunda aba com o cookie antigo, dentro da janela');
  check(!r2.cookie, 'dentro da janela, o cookie antigo recebe só o token, sem cookie novo');
  const r3 = await call(null, 'POST', '/api/auth/refresh', undefined, { headers: { cookie: novo } });
  status(r3, 200, 'o cookie novo continua valendo');
  status(await call(null, 'POST', '/api/auth/refresh'), 401, 'sem cookie');
  status(await call(null, 'POST', '/api/auth/refresh', undefined, { headers: { cookie: 'agora_refresh=1.abcdefabcdefabcdefabcdef' } }), 401, 'cookie inventado');
});

sim('Contas e sessão', 'Sair vale na hora (token e cookie) e "sair de todos os aparelhos" derruba todas as sessões', 'docs/10 A2, docs/03 §4, README (perfil)', async () => {
  const a = await reg('lo');
  const out = await call(a.tok, 'POST', '/api/auth/logout', undefined, { headers: { cookie: a.cookie } });
  status(out, 204, 'logout');
  status(await call(a.tok, 'GET', '/api/auth/me'), 401, 'token anterior');
  status(await call(null, 'POST', '/api/auth/refresh', undefined, { headers: { cookie: a.cookie } }), 401, 'cookie anterior');
  status(await login(a.email), 200, 'entrar de novo continua possível');
  // Sair de todos os aparelhos.
  const b = await login(a.email);
  const c = await login(a.email);
  const todos = await call(b.j.token, 'POST', '/api/auth/logout-all');
  status(todos, 200, 'logout-all');
  check(todos.j.ended >= 2, `deveria encerrar as 2 sessões abertas, encerrou ${todos.j.ended}`);
  for (const t of [b.j.token, c.j.token]) status(await call(t, 'GET', '/api/auth/me'), 401, 'token depois do logout-all');
});

sim('Convites', 'Convite de uso único: a pessoa nova segue quem convidou e o código não vale duas vezes', 'docs/08 §5', async () => {
  const a = await reg('iv');
  const inv = await call(a.tok, 'POST', '/api/convites');
  status(inv, 201, 'gerar convite');
  const code = inv.j.data.code;
  check(/^[a-z2-9]{8}$/.test(code) && !/[01ilo]/.test(code), `código fora do formato documentado: ${code}`);
  eq(inv.j.data.path, `/cadastro?convite=${code}`, 'caminho do convite');
  const mk = (u) => call(null, 'POST', '/api/auth/register', { username: u, email: `${u}@sim.test`, password: PASSWORD, accept_rules: true, invite_code: code });
  const u1 = 'iv1' + Math.random().toString(36).slice(2, 7);
  status(await mk(u1), 201, 'cadastro com o convite');
  const fol = await call(null, 'GET', `/api/users/${a.u}/followers`);
  check(fol.j.data.some((x) => x.username === u1), 'a pessoa convidada deveria seguir quem convidou');
  const u2 = 'iv2' + Math.random().toString(36).slice(2, 7);
  status(await mk(u2), 400, 'reuso do convite');
  status((await login(`${u2}@sim.test`)), 401, 'o reuso não pode ter criado conta');
  const list = await call(a.tok, 'GET', '/api/convites');
  check(list.j.data.find((i) => i.code === code)?.used === true, 'a lista deveria mostrar o convite como usado');
});

sim('Convites', 'Código inexistente ou malformado não cria conta; no máximo 10 convites abertos', 'docs/08 §5', async () => {
  const mk = (u, code) => call(null, 'POST', '/api/auth/register', { username: u, email: `${u}@sim.test`, password: PASSWORD, accept_rules: true, invite_code: code });
  const u = 'ic' + Math.random().toString(36).slice(2, 7);
  status(await mk(u, 'abcdefgh'), 400, 'código bem formado, mas inexistente');
  status(await mk(u, 'curto'), 400, 'código malformado');
  status(await login(`${u}@sim.test`), 401, 'nenhuma conta criada');
  const a = await reg('i10');
  for (let i = 0; i < 10; i++) status(await call(a.tok, 'POST', '/api/convites'), 201, `convite ${i + 1}`);
  status(await call(a.tok, 'POST', '/api/convites'), 409, '11º convite aberto');
});

sim('Contas e sessão', 'Corpo grande, JSON quebrado e rota inexistente respondem em JSON, sem vazar detalhes internos', 'docs/10 B1', async () => {
  const a = await reg('er');
  const big = await call(a.tok, 'POST', '/api/posts', undefined, { rawBody: JSON.stringify({ text: 'x'.repeat(40000) }) });
  status(big, 413, 'corpo de 40 KB');
  const bad = await call(a.tok, 'POST', '/api/posts', undefined, { rawBody: '{"text": ' });
  status(bad, 400, 'JSON quebrado');
  const nf = await call(null, 'GET', '/api/nao-existe');
  status(nf, 404, 'rota inexistente');
  for (const r of [big, bad, nf]) {
    const t = JSON.stringify(r.j);
    check(!/node_modules|\sat\s.*\.js|stack|ECONN|SELECT /.test(t), `a resposta vaza detalhe interno: ${t.slice(0, 120)}`);
    check(typeof r.j === 'object' && typeof r.j.error === 'string', 'a resposta de erro deveria ser JSON com "error"');
  }
});

// ---------------------------------------------------------------- Posts
sim('Posts', 'Limite de 280 caracteres, texto aparado, vazio recusado', 'docs/03, README (posts de 280)', async () => {
  const a = await reg('p280');
  status(await call(a.tok, 'POST', '/api/posts', { text: 'a'.repeat(280) }), 201, '280 caracteres');
  status(await call(a.tok, 'POST', '/api/posts', { text: 'a'.repeat(281) }), 400, '281 caracteres');
  status(await call(a.tok, 'POST', '/api/posts', { text: '' }), 400, 'vazio');
  status(await call(a.tok, 'POST', '/api/posts', { text: '   \n  ' }), 400, 'só espaços');
  status(await call(a.tok, 'POST', '/api/posts', {}), 400, 'sem texto');
  const p = await post(a, '   texto com espaços   ');
  eq(p.text, 'texto com espaços', 'texto aparado');
  check(/^\d{15,20}$/.test(p.id), `id Snowflake esperado, veio ${p.id}`);
});

sim('Posts', 'Resposta forma a thread: conversation_id herdado, reply_count e ordem', 'docs/03, README (threads)', async () => {
  const a = await reg('th');
  const b = await reg('th');
  const root = await post(a, 'post raiz');
  const r1 = await post(b, 'primeira resposta', root.id);
  const r2 = await post(a, 'resposta da resposta', r1.id);
  eq(r1.conversation_id, root.id, 'conversation_id da 1ª resposta');
  eq(r2.conversation_id, root.id, 'conversation_id da 2ª resposta');
  eq(r1.in_reply_to_post_id, root.id, 'in_reply_to');
  const t = await call(null, 'GET', `/api/posts/${root.id}/thread`);
  status(t, 200, 'thread');
  eq(t.j.data.map((p) => p.id), [root.id, r1.id, r2.id], 'ordem da thread');
  eq(t.j.meta.focal_id, root.id, 'focal_id');
  eq((await getPost(a, root.id)).j.data.public_metrics.reply_count, 1, 'reply_count do post raiz');
  status(await call(b.tok, 'POST', '/api/posts', { text: 'x', reply_to_id: '1' }), 404, 'responder a post inexistente');
  const rep = await call(b.tok, 'POST', `/api/posts/${root.id}/repost`);
  const repId = (await call(b.tok, 'GET', `/api/users/${b.u}/posts`)).j.data.find((p) => p.referenced_posts.some((x) => x.type === 'reposted')).id;
  status(await call(a.tok, 'POST', '/api/posts', { text: 'resposta a repost', reply_to_id: repId }), 409, 'responder a um repost');
  check(rep.s === 200, 'repost');
});

sim('Posts', 'Menção entra em /mentions (sem diferenciar maiúsculas), a própria menção não conta', 'docs/03 §4 (mentions)', async () => {
  const a = await reg('mn');
  const b = await reg('mn');
  const p = await post(a, `oi @${b.u.toUpperCase()} e @${a.u} e @nao_existe_ninguem`);
  const m = await call(b.tok, 'GET', '/api/mentions');
  status(m, 200, 'mentions');
  check(m.j.data.some((x) => x.id === p.id), 'a pessoa mencionada deveria ver o post em /mentions');
  const mine = await call(a.tok, 'GET', '/api/mentions');
  check(!mine.j.data.some((x) => x.id === p.id), 'auto-menção não deveria aparecer');
});

sim('Posts', 'No máximo 10 menções por post', 'docs/14 P-1', async () => {
  const a = await reg('mx');
  const ten = Array.from({ length: 10 }, (_, i) => `@pessoa_${i}`).join(' ');
  status(await call(a.tok, 'POST', '/api/posts', { text: ten }), 201, '10 menções');
  const r = await call(a.tok, 'POST', '/api/posts', { text: ten + ' @pessoa_10' });
  status(r, 400, '11 menções');
  check(/10/.test(r.j.error), `a mensagem deveria citar o limite: ${r.j.error}`);
});

sim('Posts', 'Curtir é idempotente, descurtir não passa de zero', 'docs/03 §4, README', async () => {
  const a = await reg('lk');
  const b = await reg('lk');
  const p = await post(a, 'curta este post');
  for (let i = 0; i < 3; i++) await call(b.tok, 'POST', `/api/posts/${p.id}/like`);
  let g = (await getPost(b, p.id)).j.data;
  eq(g.public_metrics.like_count, 1, 'curtidas depois de curtir 3 vezes');
  eq(g.viewer.liked, true, 'viewer.liked');
  eq((await getPost(a, p.id)).j.data.viewer.liked, false, 'a autora não curtiu');
  for (let i = 0; i < 3; i++) await call(b.tok, 'DELETE', `/api/posts/${p.id}/like`);
  g = (await getPost(b, p.id)).j.data;
  eq(g.public_metrics.like_count, 0, 'curtidas depois de descurtir');
});

sim('Posts', 'Repost: um por pessoa, repost de repost aponta ao original, desfazer', 'docs/03, README', async () => {
  const a = await reg('rp');
  const b = await reg('rp');
  const c = await reg('rp');
  const p = await post(a, 'republique');
  await call(b.tok, 'POST', `/api/posts/${p.id}/repost`);
  await call(b.tok, 'POST', `/api/posts/${p.id}/repost`);
  eq((await getPost(b, p.id)).j.data.public_metrics.repost_count, 1, 'repost duplicado não conta duas vezes');
  const repB = (await call(b.tok, 'GET', `/api/users/${b.u}/posts`)).j.data.find((x) => x.referenced_posts.some((r) => r.type === 'reposted'));
  await call(c.tok, 'POST', `/api/posts/${repB.id}/repost`);
  const g = (await getPost(c, p.id)).j.data;
  eq(g.public_metrics.repost_count, 2, 'repost do repost conta no original');
  eq(g.viewer.reposted, true, 'viewer.reposted');
  await call(b.tok, 'DELETE', `/api/posts/${p.id}/repost`);
  eq((await getPost(c, p.id)).j.data.public_metrics.repost_count, 1, 'depois de desfazer');
});

sim('Posts', 'Só o autor apaga; apagar resposta diminui o contador do post pai', 'docs/03 §4', async () => {
  const a = await reg('dl');
  const b = await reg('dl');
  const root = await post(a, 'raiz');
  const rep = await post(b, 'resposta', root.id);
  status(await call(a.tok, 'DELETE', `/api/posts/${rep.id}`), 403, 'outra pessoa apagando');
  eq((await getPost(a, root.id)).j.data.public_metrics.reply_count, 1, 'reply_count antes');
  status(await call(b.tok, 'DELETE', `/api/posts/${rep.id}`), 200, 'autor apagando');
  eq((await getPost(a, root.id)).j.data.public_metrics.reply_count, 0, 'reply_count depois');
  status(await getPost(a, rep.id), 404, 'post apagado');
  status(await call(b.tok, 'DELETE', `/api/posts/${rep.id}`), 404, 'apagar de novo');
});

sim('Posts', 'Timeline Seguindo: ordem cronológica reversa e paginação por cursor sem repetição', 'README (exemplos de API), docs/03', async () => {
  const a = await reg('tl');
  const b = await reg('tl');
  await follow(b, a.u);
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await post(a, `post ${i}`)).id);
  const all = [];
  let next = null;
  for (let page = 0; page < 5; page++) {
    const r = await call(b.tok, 'GET', `/api/timeline?max_results=2${next ? `&until_id=${next}` : ''}`);
    status(r, 200, 'timeline');
    all.push(...r.j.data.map((p) => p.id));
    next = r.j.meta.next_token;
    if (!next) break;
  }
  eq(all, [...ids].reverse(), 'ids em ordem decrescente, sem repetir nem perder');
  status(await call(b.tok, 'GET', '/api/timeline?max_results=0'), 400, 'max_results=0');
  status(await call(b.tok, 'GET', '/api/timeline?max_results=101'), 400, 'max_results=101');
  status(await call(b.tok, 'GET', '/api/timeline?max_results=100'), 200, 'max_results=100');
  status(await call(b.tok, 'GET', '/api/timeline?until_id=abc'), 400, 'cursor inválido');
});

sim('Posts', 'Fan-out: post novo chega a quem segue; deixar de seguir tira da timeline; seguir a si mesmo é recusado', 'README (fan-out em Redis)', async () => {
  const a = await reg('fo');
  const b = await reg('fo');
  status(await follow(b, b.u), 409, 'seguir a si mesmo');
  status(await follow(b, a.u), 200, 'seguir');
  status(await follow(b, a.u), 200, 'seguir de novo (idempotente)');
  const p1 = await post(a, 'primeiro');
  eq((await call(b.tok, 'GET', '/api/timeline')).j.data[0]?.id, p1.id, 'topo da timeline');
  const fm = (await call(null, 'GET', `/api/users/${a.u}`)).j.data;
  eq(fm.public_metrics.followers_count, 1, 'followers_count');
  await call(b.tok, 'DELETE', `/api/users/${a.u}/follow`);
  const p2 = await post(a, 'segundo, depois de deixar de seguir');
  const tl = (await call(b.tok, 'GET', '/api/timeline')).j.data.map((p) => p.id);
  check(!tl.includes(p1.id) && !tl.includes(p2.id), 'a timeline não pode mais mostrar os posts de quem deixou de ser seguido');
});

sim('Visitantes', 'Visitante lê tudo o que é público, mas nenhuma interação funciona e nada é alterado', 'README (visitantes só leem), docs/14', async () => {
  const a = await reg('vs');
  const p = await post(a, 'só leitura para quem não entrou');
  for (const path of ['/api/posts', `/api/posts/${p.id}`, `/api/posts/${p.id}/thread`, `/api/users/${a.u}`, `/api/users/${a.u}/posts`, `/federation/users/${a.u}/outbox`, '/api/instancia/regras', '/api/dados', '/api/token', '/api/feed/algoritmo']) {
    status(await call(null, 'GET', path), 200, `GET ${path} sem login`);
  }
  eq((await getPost(null, p.id)).j.data.viewer, { liked: false, reposted: false, tipped: false, can_edit: false }, 'viewer do visitante');
  const tries = [['POST', '/api/posts', { text: 'x' }], ['POST', `/api/posts/${p.id}/like`], ['POST', `/api/posts/${p.id}/repost`], ['POST', `/api/posts/${p.id}/recompensa`], ['POST', `/api/users/${a.u}/follow`], ['POST', `/api/users/${a.u}/mute`], ['POST', `/api/users/${a.u}/block`], ['POST', '/api/denuncias', { post_id: p.id, reason: 'spam' }], ['DELETE', `/api/posts/${p.id}`], ['GET', '/api/carteira'], ['GET', '/api/channels'], ['GET', '/api/missoes'], ['GET', '/api/timeline'], ['GET', '/api/mentions'], ['GET', '/api/feed/candidatos']];
  for (const [m, path, body] of tries) status(await call(null, m, path, body), 401, `${m} ${path} sem login`);
  const g = (await getPost(a, p.id)).j.data;
  eq([g.public_metrics.like_count, g.public_metrics.repost_count, g.public_metrics.tip_count], [0, 0, 0], 'contadores intactos');
});

sim('Visitantes', 'Posts de conta suspensa somem para todos, inclusive visitantes', 'docs/11 §2 (hydrate)', async () => {
  const m = await mod();
  const a = await reg('sp');
  const b = await reg('sp');
  const p = await post(a, 'post antes da suspensão');
  const rep = await call(b.tok, 'POST', '/api/denuncias', { username: a.u, reason: 'spam' });
  status(rep, 201, 'denúncia');
  const regra = (await rules())[3].id;
  status(await call(m.tok, 'POST', `/api/moderacao/denuncias/${rep.j.data.id}/resolver`, { action: 'suspender', rule_id: regra, note: 'simulação' }), 200, 'suspender');
  status(await getPost(null, p.id), 404, 'visitante abrindo o post');
  status(await getPost(b, p.id), 404, 'logado abrindo o post');
  status(await call(null, 'GET', `/api/users/${a.u}`), 404, 'perfil da conta suspensa');
  const pub = (await call(null, 'GET', '/api/posts?max_results=50')).j.data;
  check(!pub.some((x) => x.id === p.id), 'timeline pública ainda mostra o post');
  const busca = await call(b.tok, 'GET', `/api/users?q=${a.u}`);
  check(!busca.j.data.some((u) => u.username === a.u), 'a busca ainda acha a conta suspensa');
  await call(m.tok, 'POST', `/api/moderacao/usuarios/${a.u}/reativar`);
});

sim('Perfis', 'Seguir e deixar de seguir atualiza contadores, listas e relação; busca de pessoas', 'docs/03 §4', async () => {
  const a = await reg('pf');
  const b = await reg('pf');
  await follow(b, a.u);
  const pa = (await call(b.tok, 'GET', `/api/users/${a.u}`)).j.data;
  eq([pa.public_metrics.followers_count, pa.relationship.following, pa.relationship.followed_by], [1, true, false], 'perfil da A visto pela B');
  const pb = (await call(a.tok, 'GET', `/api/users/${b.u}`)).j.data;
  eq([pb.public_metrics.following_count, pb.relationship.followed_by], [1, true], 'perfil da B visto pela A');
  eq((await call(null, 'GET', `/api/users/${a.u}/followers`)).j.data.map((u) => u.username), [b.u], 'lista de seguidores');
  eq((await call(null, 'GET', `/api/users/${b.u}/following`)).j.data.map((u) => u.username), [a.u], 'lista de quem segue');
  check((await call(null, 'GET', `/api/users?q=${a.u.slice(0, 6)}`)).j.data.some((u) => u.username === a.u), 'busca por parte do usuário');
  eq((await call(null, 'GET', '/api/users?q=%25')).j.data.length, 0, '"%" não pode funcionar como curinga');
  status(await call(null, 'GET', '/api/users?q='), 400, 'busca vazia');
  status(await call(null, 'GET', '/api/users/ninguem_assim_existe'), 404, 'perfil inexistente');
});
