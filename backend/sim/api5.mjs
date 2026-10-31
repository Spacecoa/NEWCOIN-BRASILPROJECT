// Simulações da privacidade do piloto (docs/16), numeradas de S101 a S103 para não mudar
// a numeração das 100 primeiras.
import { call, check, eq, follow, getPost, login, PASSWORD, post, reg, sim, sql, status } from './lib.mjs';

sim('Privacidade e dados', 'Baixar meus dados: arquivo com posts, edições, curtidas, seguidas e carteira; sem segredos nem quem denunciou', 'docs/16 §1', async () => {
  const a = await reg('dd');
  const b = await reg('dd');
  status(await call(null, 'GET', '/api/conta/dados'), 401, 'sem login');
  const p = await post(a, 'post para levar junto');
  await call(a.tok, 'PATCH', `/api/posts/${p.id}`, { text: 'post para levar junto (editado)' });
  const pb = await post(b, 'post de outra pessoa');
  await call(a.tok, 'POST', `/api/posts/${pb.id}/like`);
  await follow(a, b.u);
  await call(b.tok, 'POST', '/api/denuncias', { post_id: p.id, reason: 'spam' });
  const r = await call(a.tok, 'GET', '/api/conta/dados');
  status(r, 200, 'baixar');
  check(/^attachment; filename="agora-dados-/.test(r.h.get('content-disposition') ?? ''), 'deveria vir como arquivo');
  eq(r.h.get('cache-control'), 'no-store', 'sem cache');
  eq(r.j.conta.email, a.email, 'e-mail da conta');
  eq(r.j.posts.map((x) => [x.text, x.edicoes.length]), [['post para levar junto (editado)', 1]], 'post com a edição');
  eq(r.j.curtidas.map((x) => x.post_id), [pb.id], 'curtida');
  eq(r.j.seguindo.map((x) => x.username), [b.u], 'seguindo');
  check(r.j.newcoin.saldo === r.j.newcoin.extrato.reduce((s, l) => s + l.amount, 0), 'saldo bate com o extrato');
  const raw = JSON.stringify(r.j);
  check(!/password_hash|refresh_hash|token_hash|\$2[aby]\$/.test(raw), 'o arquivo não pode ter segredos');
  eq(r.j.denuncias_feitas, [], 'a conta não denunciou ninguém');
  check(!JSON.stringify({ d: r.j.decisoes_sobre_voce, n: r.j.notificacoes.filter((x) => x.kind !== 'follow') }).includes(b.u), 'quem denunciou não pode aparecer');
  check(!raw.includes('post de outra pessoa'), 'texto de outra pessoa não vai no arquivo');
  return `${Math.round(raw.length / 1024)} KB`;
}, { extra: true });

sim('Privacidade e dados', 'Excluir a conta: senha conferida, tudo some, números dos outros recontados, @ reservado e convite que não volta', 'docs/16 §2', async () => {
  const dona = await reg('dx');
  const b = await reg('dx');
  const inv = (await call(dona.tok, 'POST', '/api/convites')).j.data.code;
  const a = await reg('dx', { extra: { invite_code: inv } });
  const pb = await post(b, 'post que a conta vai curtir e responder');
  await call(a.tok, 'POST', `/api/posts/${pb.id}/like`);
  await post(a, 'resposta que vai sumir', pb.id);
  const pa = await post(a, 'post que vai sumir');
  eq((await getPost(b, pb.id)).j.data.public_metrics.reply_count, 1, 'resposta contada');
  status(await call(a.tok, 'DELETE', '/api/conta', { password: 'senha-errada-1' }), 403, 'senha errada');
  status(await call(a.tok, 'GET', '/api/auth/me'), 200, 'senha errada não derruba a sessão');
  status(await call(a.tok, 'DELETE', '/api/conta', { password: PASSWORD }), 200, 'excluir');
  status(await call(a.tok, 'GET', '/api/auth/me'), 401, 'a sessão caiu na hora');
  status(await login(a.email), 401, 'não entra mais');
  status(await getPost(b, pa.id), 404, 'o post sumiu');
  const m = (await getPost(b, pb.id)).j.data.public_metrics;
  eq([m.like_count, m.reply_count], [0, 0], 'números do post da outra pessoa');
  eq(sql(`SELECT count(*) FROM posts WHERE author_id = ${a.id}`), '0', 'nada da conta no banco');
  const again = await call(null, 'POST', '/api/auth/register', { username: a.u.toUpperCase(), email: `novo_${a.email}`, password: PASSWORD, accept_rules: true, accept_consent: true });
  status(again, 409, 'o @ fica reservado');
  status(await call(null, 'POST', '/api/auth/register', { username: `${a.u.slice(0, 15)}_n`, email: a.email, password: PASSWORD, accept_rules: true, accept_consent: true }), 201, 'o e-mail fica livre');
  status(await call(null, 'POST', '/api/auth/register', { username: `${b.u.slice(0, 15)}_c`, email: `c_${b.email}`, password: PASSWORD, accept_rules: true, accept_consent: true, invite_code: inv }), 400, 'o convite usado não volta a valer');
}, { extra: true });

sim('Privacidade e dados', 'Termo do piloto: público, aceite obrigatório no cadastro, versão velha recusada; conta com termo antigo aceita depois', 'docs/16 §4', async () => {
  const t = (await call(null, 'GET', '/api/instancia/termo')).j.data;
  check(t.version && t.sections.length >= 8, 'o termo deveria ter versão e as 8 seções');
  for (const s of ['Quem conduz a pesquisa', 'O que o app guarda', 'Por quanto tempo', 'Seus direitos (LGPD, art. 18)']) check(t.sections.some((x) => x.title === s), `faltou a seção "${s}"`);
  const base = { email: `termo_${Date.now()}@sim.test`, password: PASSWORD, accept_rules: true };
  const sem = await call(null, 'POST', '/api/auth/register', { ...base, username: `tm_${Date.now() % 1e8}` });
  status(sem, 400, 'cadastro sem o aceite');
  check(sem.j.details.some((d) => d.path === 'accept_consent'), 'o erro deveria apontar o aceite do termo');
  status(await call(null, 'POST', '/api/auth/register', { ...base, username: `tm_${Date.now() % 1e8}`, accept_consent: true, consent_version: 'velha' }), 409, 'versão velha do termo');
  const a = await reg('tm');
  eq((await call(a.tok, 'GET', '/api/auth/me')).j.user.consent.pending, false, 'quem acabou de aceitar está em dia');
  sql(`UPDATE users SET consent_version = 'velha' WHERE id = ${a.id}`);
  const me = (await login(a.email)).j.user.consent;
  eq([me.pending, me.current], [true, t.version], 'conta com termo antigo');
  const tok = (await login(a.email)).j.token;
  status(await call(tok, 'POST', '/api/conta/termo', { version: 'velha' }), 409, 'aceitar outra versão');
  status(await call(tok, 'POST', '/api/conta/termo', { version: t.version }), 200, 'aceitar a atual');
  eq((await call(tok, 'GET', '/api/auth/me')).j.user.consent.pending, false, 'em dia depois de aceitar');
}, { extra: true });
