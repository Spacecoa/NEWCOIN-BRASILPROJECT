import { PASSWORD, call, cfg, check, eq, follow, getPost, login, mod, post, reg, rules, sleep, socket, sql, state, status, sim, wallet, waitFor, userWithMission } from './lib.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mkChan = (who, kind) => call(who.tok, 'POST', '/api/channels', { slug: `g${Math.random().toString(36).slice(2, 9)}`, title: 'Espaço de teste', kind });
const rep = (who, body) => call(who.tok, 'POST', '/api/denuncias', body);
const suspend = async (m, reporter, target, note = 'simulação') => {
  const r = await rep(reporter, { username: target.u, reason: 'spam' });
  status(r, 201, 'denúncia da conta');
  const x = await call(m.tok, 'POST', `/api/moderacao/denuncias/${r.j.data.id}/resolver`, { action: 'suspender', rule_id: (await rules())[3].id, note });
  status(x, 200, 'suspender');
  return r.j.data.id;
};

// ---------------------------------------------------------------- Moderação
sim('Moderação', 'Silenciar: some dos feeds, continua aberto de propósito, é privado e dá para desfazer', 'docs/11 §1 e §2', async () => {
  const a = await reg('mu');
  const b = await reg('mu');
  await follow(a, b.u);
  const p = await post(b, 'post da pessoa que será silenciada');
  eq((await call(a.tok, 'GET', '/api/timeline')).j.data[0]?.id, p.id, 'antes de silenciar');
  status(await call(a.tok, 'POST', `/api/users/${b.u}/mute`), 200, 'silenciar');
  check(!(await call(a.tok, 'GET', '/api/timeline')).j.data.some((x) => x.id === p.id), 'a timeline ainda mostra o post');
  check(!(await call(a.tok, 'GET', '/api/posts?max_results=50')).j.data.some((x) => x.id === p.id), 'a timeline pública ainda mostra o post');
  status(await getPost(a, p.id), 200, 'abrir o post de propósito');
  check((await call(a.tok, 'GET', `/api/users/${b.u}/posts`)).j.data.some((x) => x.id === p.id), 'o perfil aberto de propósito deveria mostrar o post');
  check((await call(a.tok, 'GET', '/api/conta/silenciados')).j.data.some((u) => u.username === b.u), 'lista de silenciados');
  const bView = (await call(b.tok, 'GET', `/api/users/${a.u}`)).j.data;
  eq(bView.relationship.muting, false, 'a pessoa silenciada não pode ver que foi silenciada');
  status(await call(a.tok, 'POST', `/api/users/${a.u}/mute`), 409, 'silenciar a si mesma');
  status(await call(a.tok, 'DELETE', `/api/users/${b.u}/mute`), 200, 'desfazer');
  check((await call(a.tok, 'GET', '/api/timeline')).j.data.some((x) => x.id === p.id), 'depois de desfazer, o post volta');
});

sim('Moderação', 'Bloquear vale nos dois sentidos: desfaz follows, impede interações e esconde os posts; desbloquear libera', 'docs/11 §1 e §2', async () => {
  const a = await reg('bk');
  const b = await reg('bk');
  await follow(a, b.u);
  await follow(b, a.u);
  const pa = await post(a, 'post da A');
  const pb = await post(b, 'post da B');
  status(await call(a.tok, 'POST', `/api/users/${b.u}/block`), 200, 'bloquear');
  const rel = (await call(a.tok, 'GET', `/api/users/${b.u}`)).j.data.relationship;
  eq([rel.blocking, rel.following, rel.followed_by], [true, false, false], 'relação depois de bloquear (os follows caem)');
  eq((await call(b.tok, 'GET', `/api/users/${a.u}`)).j.data.relationship.blocked_by, true, 'a bloqueada vê que foi bloqueada');
  for (const [who, other, p, label] of [[b, a, pa, 'B → post da A'], [a, b, pb, 'A → post da B']]) {
    for (const [m, path, body] of [['POST', `/api/posts/${p.id}/like`], ['POST', `/api/posts/${p.id}/repost`], ['POST', `/api/posts/${p.id}/recompensa`], ['POST', '/api/posts', { text: 'resposta', reply_to_id: p.id }], ['POST', `/api/users/${other.u}/follow`]]) {
      const r = await call(who.tok, m, path, body);
      check(r.s === 403, `${label} ${m} ${path.split('/').slice(-1)[0]}: esperado 403, veio ${r.s}`);
    }
    status(await getPost(who, p.id), 404, `${label}: abrir o post`);
  }
  const prof = await call(b.tok, 'GET', `/api/users/${a.u}/posts`);
  eq([prof.j.data.length, prof.j.meta.blocked, prof.j.meta.next_token], [0, true, undefined], 'perfil de quem bloqueou (vazio, sem "carregar mais")');
  check((await call(a.tok, 'GET', '/api/conta/bloqueados')).j.data.some((u) => u.username === b.u), 'lista de bloqueados');
  status(await call(a.tok, 'DELETE', `/api/users/${b.u}/block`), 200, 'desbloquear');
  status(await getPost(b, pa.id), 200, 'depois de desbloquear, o post volta');
  status(await follow(b, a.u), 200, 'depois de desbloquear, dá para seguir de novo');
});

sim('Moderação', 'Denúncia: motivos, validações, duplicata e denúncia de si mesma', 'docs/11 §2 (denúncias)', async () => {
  const a = await reg('dn');
  const b = await reg('dn');
  const p = await post(b, 'post para denunciar');
  const motivos = (await call(null, 'GET', '/api/denuncias/motivos')).j.data.map((m) => m.id);
  eq(motivos.sort(), ['assedio', 'golpe', 'odio', 'outro', 'spam', 'violencia'], 'motivos');
  status(await rep(a, { post_id: p.id, reason: 'chato' }), 400, 'motivo inválido');
  status(await rep(a, { post_id: p.id, reason: 'outro' }), 400, '"outro" sem explicação');
  status(await rep(a, { post_id: p.id, username: b.u, reason: 'spam' }), 400, 'post e conta juntos');
  status(await rep(a, { reason: 'spam' }), 400, 'sem alvo');
  status(await rep(a, { post_id: '1', reason: 'spam' }), 404, 'post inexistente');
  status(await rep(a, { username: 'ninguem_assim', reason: 'spam' }), 404, 'conta inexistente');
  status(await rep(a, { post_id: p.id, reason: 'outro', details: 'explicação' }), 201, 'denúncia válida');
  status(await rep(a, { post_id: p.id, reason: 'spam' }), 409, 'denúncia repetida');
  status(await rep(b, { username: b.u, reason: 'spam' }), 409, 'denunciar a si mesma');
  const mine = (await call(a.tok, 'GET', '/api/denuncias')).j.data;
  eq([mine.length, mine[0].status, mine[0].post_text], [1, 'aberta', 'post para denunciar'], 'minhas denúncias');
  status(await call(null, 'GET', '/api/denuncias'), 401, 'sem login');
});

sim('Moderação', 'Denunciar um repost denuncia o original; o texto do post fica copiado na denúncia', 'docs/11 §2 (denúncias)', async () => {
  const a = await reg('dr');
  const b = await reg('dr');
  const c = await reg('dr');
  const p = await post(b, 'post original');
  await call(c.tok, 'POST', `/api/posts/${p.id}/repost`);
  const repostId = (await call(c.tok, 'GET', `/api/users/${c.u}/posts`)).j.data.find((x) => x.referenced_posts.some((r) => r.type === 'reposted')).id;
  const r = await rep(a, { post_id: repostId, reason: 'spam' });
  status(r, 201, 'denunciar o repost');
  const m = await mod();
  const q = (await call(m.tok, 'GET', '/api/moderacao/denuncias?status=aberta')).j.data.find((x) => x.id === r.j.data.id);
  eq([q.target_username, q.post_text, q.post_id], [b.u, 'post original', p.id], 'a denúncia deveria apontar para o autor e o post originais');
  await call(b.tok, 'DELETE', `/api/posts/${p.id}`);
  const q2 = (await call(m.tok, 'GET', '/api/moderacao/denuncias?status=aberta')).j.data.find((x) => x.id === r.j.data.id);
  eq(q2.post_text, 'post original', 'o texto continua na denúncia mesmo com o post apagado');
});

sim('Moderação', 'Fila só para a moderação, com contagem de denúncias abertas; quem é denunciado nunca vê quem denunciou', 'docs/11 §1 e §2', async () => {
  const a = await reg('fl');
  const c = await reg('fl');
  const alvo = await reg('fl');
  const m = await mod();
  const p1 = await post(alvo, 'primeiro post ruim');
  const p2 = await post(alvo, 'segundo post ruim');
  const r1 = (await rep(a, { post_id: p1.id, reason: 'spam' })).j.data;
  await rep(c, { post_id: p2.id, reason: 'golpe' });
  status(await call(a.tok, 'GET', '/api/moderacao/denuncias'), 403, 'pessoa comum');
  status(await call(null, 'GET', '/api/moderacao/denuncias'), 401, 'sem login');
  const q = (await call(m.tok, 'GET', '/api/moderacao/denuncias')).j.data.filter((x) => x.target_username === alvo.u);
  eq([q.length, q[0].open_against_target], [2, 2], 'a fila deveria mostrar que a conta acumula 2 denúncias abertas');
  check(q.every((x) => x.reporter_username), 'a moderação vê quem denunciou');
  eq((await call(alvo.tok, 'GET', '/api/denuncias')).j.data, [], 'quem foi denunciado não vê as denúncias recebidas');
  await call(m.tok, 'POST', `/api/moderacao/denuncias/${r1.id}/resolver`, { action: 'arquivar', note: 'sem violação' });
  const meu = (await call(a.tok, 'GET', '/api/denuncias')).j.data[0];
  eq([meu.status, meu.resolution, meu.resolution_note], ['arquivada', 'arquivar', 'sem violação'], 'quem denunciou vê o resultado e a nota');
  check(!JSON.stringify(meu).includes('resolved_by') || !('resolved_by_username' in meu), 'quem denunciou não deve ver qual moderador decidiu');
});

sim('Moderação', 'Remover post exige citar a regra; o post sai do ar e as outras denúncias do mesmo post são resolvidas', 'docs/12 §1 e §3', async () => {
  const a = await reg('rm');
  const c = await reg('rm');
  const autor = await reg('rm');
  const m = await mod();
  const p = await post(autor, 'post que vai sair do ar');
  const r1 = (await rep(a, { post_id: p.id, reason: 'spam' })).j.data;
  const r2 = (await rep(c, { post_id: p.id, reason: 'golpe' })).j.data;
  const res = (body) => call(m.tok, 'POST', `/api/moderacao/denuncias/${r1.id}/resolver`, body);
  status(await res({ action: 'remover_post' }), 400, 'sem regra');
  status(await res({ action: 'remover_post', rule_id: '1' }), 400, 'regra inexistente');
  status(await res({ action: 'apagar_tudo' }), 400, 'ação desconhecida');
  const regra = (await rules())[3];
  const ok = await res({ action: 'remover_post', rule_id: regra.id, note: 'repetido' });
  status(ok, 200, 'remover citando a regra');
  eq(ok.j.data.rule.title, regra.title, 'a regra citada fica na denúncia');
  status(await getPost(c, p.id), 404, 'o post some para todos');
  const mine2 = (await call(c.tok, 'GET', '/api/denuncias')).j.data[0];
  eq([mine2.status, mine2.resolution], ['acatada', 'remover_post'], 'a outra denúncia do mesmo post foi resolvida junto');
  status(await res({ action: 'arquivar' }), 409, 'decidir de novo');
  status(await call(c.tok, 'POST', `/api/moderacao/denuncias/${r2.id}/resolver`, { action: 'arquivar' }), 403, 'pessoa comum decidindo');
  status(await call(c.tok, 'POST', `/api/posts/${p.id}/like`), 404, 'curtir post removido');
});

sim('Moderação', 'Suspender: login 403 com o motivo, sessões caem na hora, conta some; reativar desfaz', 'docs/11 §2, docs/12 §3', async () => {
  const a = await reg('sx');
  const b = await reg('sx');
  const m = await mod();
  const p = await post(a, 'post da conta que será suspensa');
  const antes = await call(a.tok, 'GET', '/api/auth/me');
  status(antes, 200, 'antes de suspender');
  await suspend(m, b, a, 'nota da simulação');
  status(await call(a.tok, 'GET', '/api/auth/me'), 401, 'o token antigo deve cair na hora');
  const l = await login(a.email);
  status(l, 403, 'login com a senha certa');
  eq([l.j.suspension.rule.title.length > 0, l.j.suspension.note, l.j.suspension.can_appeal, l.j.suspension.appeal_status], [true, 'nota da simulação', true, null], 'dados do aviso de suspensão');
  const errada = await login(a.email, 'senha-errada-1');
  status(errada, 401, 'login com a senha errada');
  check(errada.j.suspension === undefined, 'a senha errada não pode revelar a suspensão');
  status(await call(null, 'GET', `/api/users/${a.u}`), 404, 'perfil');
  status(await getPost(b, p.id), 404, 'post');
  status(await call(b.tok, 'POST', `/api/users/${a.u}/follow`), 404, 'seguir conta suspensa');
  const re = await call(m.tok, 'POST', `/api/moderacao/usuarios/${a.u}/reativar`);
  status(re, 200, 'reativar');
  status(await login(a.email), 200, 'entrar depois de reativada');
  status(await call(m.tok, 'POST', `/api/moderacao/usuarios/${a.u}/reativar`), 404, 'reativar quem não está suspensa');
});

sim('Moderação', 'A moderação não suspende a si mesma nem outra conta da moderação', 'docs/11 §2 (proteções)', async () => {
  const b = await reg('pm');
  const m = await mod();
  const r = await rep(b, { username: 'ana_dev', reason: 'spam' });
  status(r, 201, 'denunciar a moderadora');
  const x = await call(m.tok, 'POST', `/api/moderacao/denuncias/${r.j.data.id}/resolver`, { action: 'suspender', rule_id: (await rules())[3].id });
  check(x.s === 409, `esperado 409, veio ${x.s}`);
  status(await call(m.tok, 'GET', '/api/auth/me'), 200, 'a moderadora continua com acesso');
  await call(m.tok, 'POST', `/api/moderacao/denuncias/${r.j.data.id}/resolver`, { action: 'arquivar' });
});

sim('Moderação', 'Recurso de post removido: um só, de 10 a 1000 caracteres; aceitar devolve o post com as curtidas', 'docs/12 §1 e §3', async () => {
  const autor = await reg('ap');
  const b = await reg('ap');
  const m = await mod();
  const p = await post(autor, 'post removido por engano');
  await call(b.tok, 'POST', `/api/posts/${p.id}/like`);
  const r = (await rep(b, { post_id: p.id, reason: 'spam' })).j.data;
  await call(m.tok, 'POST', `/api/moderacao/denuncias/${r.id}/resolver`, { action: 'remover_post', rule_id: (await rules())[3].id, note: 'ok' });
  const d = (await call(autor.tok, 'GET', '/api/conta/decisoes')).j.data;
  eq([d.length, d[0].kind, d[0].post_text, typeof d[0].rule.title], [1, 'post_removido', 'post removido por engano', 'string'], 'decisão vista pela autora');
  const url = `/api/conta/decisoes/${d[0].id}/recurso`;
  status(await call(autor.tok, 'POST', url, { text: 'curto' }), 400, 'menos de 10 caracteres');
  status(await call(autor.tok, 'POST', url, { text: 'x'.repeat(1001) }), 400, 'mais de 1000 caracteres');
  status(await call(b.tok, 'POST', url, { text: 'recurso de outra pessoa' }), 404, 'recurso de decisão alheia');
  status(await call(autor.tok, 'POST', url, { text: 'Foi um engano, o post cumpre as regras.' }), 201, 'recurso válido');
  status(await call(autor.tok, 'POST', url, { text: 'tentando de novo mais uma vez' }), 409, 'segundo recurso');
  const fila = (await call(m.tok, 'GET', '/api/moderacao/recursos?status=aberto')).j.data;
  check(fila.some((x) => x.id === d[0].id), 'o recurso deveria estar na fila da moderação');
  status(await call(autor.tok, 'GET', '/api/moderacao/recursos'), 403, 'fila de recursos para pessoa comum');
  status(await call(m.tok, 'POST', `/api/moderacao/recursos/${d[0].id}/decidir`, { decision: 'aceitar', note: 'revisto' }), 200, 'aceitar');
  const volta = await getPost(b, p.id);
  status(volta, 200, 'o post volta');
  eq(volta.j.data.public_metrics.like_count, 1, 'curtidas preservadas');
  status(await call(autor.tok, 'POST', url, { text: 'recurso depois de desfeita' }), 409, 'recurso de decisão já desfeita');
});

sim('Moderação', 'Recurso de conta suspensa por e-mail e senha: aceito, a conta volta; negado, a suspensão fica', 'docs/12 §1 e §3', async () => {
  const m = await mod();
  const a = await reg('rs');
  const b = await reg('rs');
  const x = await reg('rs');
  await suspend(m, x, a);
  await suspend(m, x, b);
  const url = '/api/recursos/suspensao';
  status(await call(null, 'POST', url, { email: a.email, password: 'senha-errada-1', text: 'quero recorrer da suspensão' }), 401, 'senha errada');
  status(await call(null, 'POST', url, { email: a.email, password: PASSWORD, text: 'curto' }), 400, 'texto curto');
  status(await call(null, 'POST', url, { email: a.email, password: PASSWORD, text: 'Minha conta foi invadida naquele dia.' }), 201, 'recurso de A');
  status(await call(null, 'POST', url, { email: a.email, password: PASSWORD, text: 'mais uma vez por favor' }), 409, 'segundo recurso de A');
  status(await call(null, 'POST', url, { email: b.email, password: PASSWORD, text: 'Foi um engano, por favor revejam.' }), 201, 'recurso de B');
  const fila = (await call(m.tok, 'GET', '/api/moderacao/recursos?status=aberto')).j.data;
  const ra = fila.find((r) => r.username === a.u);
  const rb = fila.find((r) => r.username === b.u);
  check(ra && rb, 'os dois recursos deveriam estar na fila');
  status(await call(m.tok, 'POST', `/api/moderacao/recursos/${ra.id}/decidir`, { decision: 'aceitar' }), 200, 'aceitar A');
  status(await call(m.tok, 'POST', `/api/moderacao/recursos/${rb.id}/decidir`, { decision: 'negar', note: 'mantida' }), 200, 'negar B');
  status(await login(a.email), 200, 'A volta a entrar');
  const lb = await login(b.email);
  status(lb, 403, 'B continua suspensa');
  eq([lb.j.suspension.appeal_status, lb.j.suspension.appeal_note, lb.j.suspension.can_appeal], ['negado', 'mantida', false], 'B vê o resultado do recurso');
  await call(m.tok, 'POST', `/api/moderacao/usuarios/${b.u}/reativar`);
});

sim('Regras da instância', 'Regras públicas sem login: as 7 padrão, com quem modera e a data da última edição', 'docs/12 §1 e §2', async () => {
  const r = await call(null, 'GET', '/api/instancia/regras');
  status(r, 200, 'sem login');
  const titulos = r.j.data.rules.map((x) => x.title);
  for (const t of ['Respeite as pessoas', 'Sem discurso de ódio', 'Sem golpes nem se passar por outra pessoa', 'Sem spam', 'Proteja a privacidade', 'O NWC não é dinheiro', 'Nada ilegal']) check(titulos.includes(t), `faltou a regra padrão "${t}"`);
  check(r.j.data.rules.every((x, i) => x.position === i + 1 && x.description), 'numeração e descrição');
  check(r.j.data.moderators.some((u) => u.username === 'ana_dev'), 'a lista deveria mostrar quem modera');
  check(r.j.data.updated_at, 'faltou a data da última edição');
});

sim('Regras da instância', 'Editar regras: só a moderação, mínimo 1 e máximo 15; regra retirada fica arquivada e as decisões antigas mantêm o texto', 'docs/12 §3', async () => {
  const m = await mod();
  const a = await reg('er');
  const atual = await rules();
  const manter = atual.map(({ id, title, description }) => ({ id, title, description }));
  const put = (tok, list) => call(tok, 'PUT', '/api/moderacao/regras', { rules: list });
  status(await put(a.tok, manter), 403, 'pessoa comum');
  status(await put(null, manter), 401, 'sem login');
  status(await put(m.tok, []), 400, 'lista vazia');
  status(await put(m.tok, Array.from({ length: 16 }, (_, i) => ({ title: `Regra ${i}`, description: '' }))), 400, '16 regras');
  const nova = { title: 'Regra da simulação', description: 'só para esta simulação' };
  const r1 = await put(m.tok, [...manter, nova]);
  status(r1, 200, 'adicionar uma regra');
  const criada = r1.j.data.rules.find((x) => x.title === nova.title);
  check(criada && r1.j.data.rules.length === atual.length + 1, 'a regra nova deveria entrar no fim');
  const autor = await reg('er');
  const p = await post(autor, 'post para a regra nova');
  const d = (await rep(a, { post_id: p.id, reason: 'spam' })).j.data;
  status(await call(m.tok, 'POST', `/api/moderacao/denuncias/${d.id}/resolver`, { action: 'remover_post', rule_id: criada.id }), 200, 'citar a regra nova');
  const r2 = await put(m.tok, manter);
  status(r2, 200, 'retirar a regra');
  check(!r2.j.data.rules.some((x) => x.id === criada.id), 'a regra retirada não pode mais aparecer');
  const dec = (await call(autor.tok, 'GET', '/api/conta/decisoes')).j.data[0];
  eq([dec.rule.title, dec.rule.archived], [nova.title, true], 'a decisão antiga mantém o texto da regra, marcada como arquivada');
  const outro = await reg('er');
  const p2 = await post(outro, 'outro post');
  const d2 = (await rep(a, { post_id: p2.id, reason: 'spam' })).j.data;
  status(await call(m.tok, 'POST', `/api/moderacao/denuncias/${d2.id}/resolver`, { action: 'remover_post', rule_id: criada.id }), 400, 'citar regra arquivada');
  eq((await rules()).map((x) => x.title), atual.map((x) => x.title), 'a lista ativa voltou ao que era');
});

sim('Moderação', 'Mensagens de bloqueada, silenciada e de conta suspensa no grupo: aviso, recolhida e aviso, sempre com o mesmo pts', 'docs/11 §2 (grupos e canais)', async () => {
  const m = await mod();
  const a = await reg('gb');
  const b = await reg('gb');
  const c = await reg('gb');
  const d = await reg('gb');
  const ch = (await mkChan(a, 'group')).j.data;
  for (const w of [b, c, d]) await call(w.tok, 'POST', `/api/channels/${ch.slug}/members`);
  const say = async (w, t) => (await call(w.tok, 'POST', `/api/channels/${ch.slug}/messages`, { text: t })).j.data;
  const mb = await say(b, 'mensagem da B');
  const mc = await say(c, 'mensagem da C');
  const md = await say(d, 'mensagem da D');
  await call(a.tok, 'POST', `/api/users/${b.u}/block`);
  await call(a.tok, 'POST', `/api/users/${c.u}/mute`);
  await suspend(m, a, d);
  const h = (await call(a.tok, 'GET', `/api/channels/${ch.slug}/messages`)).j;
  const by = (id) => h.data.find((x) => x.id === id);
  eq([by(mb.id).hidden, by(mb.id).text, by(mb.id).author_id, by(mb.id).pts], ['bloqueio', null, null, mb.pts], 'bloqueio: aviso sem texto nem autor e com o mesmo pts');
  eq([by(mc.id).muted, by(mc.id).text], [true, 'mensagem da C'], 'silêncio: texto marcado para recolher');
  eq([by(md.id).hidden, by(md.id).text], ['suspensa', null], 'conta suspensa');
  eq(h.data.map((x) => x.pts).sort((x, y) => x - y), [1, 2, 3], 'os pts continuam contínuos');
  const bv = (await call(b.tok, 'GET', `/api/channels/${ch.slug}/messages`)).j.data;
  eq([bv.find((x) => x.id === mc.id).text, bv.find((x) => x.id === mc.id).hidden], ['mensagem da C', undefined], 'a bloqueada continua vendo as mensagens de quem não a bloqueou');
  status(await call(a.tok, 'POST', `/api/channels/${ch.slug}/messages/${mb.id}/reactions`, { emoji: '👍' }), 403, 'reagir à mensagem da bloqueada');
  const sa = await socket(a);
  try {
    await sa.emitWithAck('channel:subscribe', { slug: ch.slug });
    await say(b, 'ao vivo da B');
    const ev = await waitFor(() => sa.events.find((e) => e.ev === 'message:new'));
    eq([ev?.p.data.hidden, ev?.p.data.text], ['bloqueio', null], 'ao vivo, a bloqueada também chega como aviso');
  } finally {
    sa.close();
  }
  await call(m.tok, 'POST', `/api/moderacao/usuarios/${d.u}/reativar`);
});

sim('Moderação', 'No máximo 20 denúncias por dia por pessoa', 'docs/11 §2 (limite de denúncias)', async () => {
  state.base = cfg.limited;
  const a = await reg('lm', { base: cfg.limited });
  const b = await reg('lm', { base: cfg.limited });
  const posts = [];
  for (let i = 0; i < 21; i++) posts.push((await post(b, `post ${i}`)).id);
  for (let i = 0; i < 20; i++) {
    const r = await rep(a, { post_id: posts[i], reason: 'spam' });
    check(r.s === 201, `denúncia ${i + 1}: esperado 201, veio ${r.s}`);
  }
  const r = await rep(a, { post_id: posts[20], reason: 'spam' });
  status(r, 429, '21ª denúncia');
}, { limited: true });
