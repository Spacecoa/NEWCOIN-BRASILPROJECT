import { PASSWORD, call, cfg, check, eq, follow, getPost, login, mod, post, reg, rules, sleep, sql, state, status, sim, wallet, userWithMission } from './lib.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BACKEND = fileURLToPath(new URL('..', import.meta.url));
const rep = (who, body) => call(who.tok, 'POST', '/api/denuncias', body);
const like = (who, id) => call(who.tok, 'POST', `/api/posts/${id}/like`);
const missionsOf = async (who) => (await call(who.tok, 'GET', '/api/missoes')).j;
const find = (m, id) => m.missions.find((x) => x.id === id);

// ---------------------------------------------------------------- Missões e token
sim('Missões e token', 'Missões do dia: 4 (2 de engajamento + 2 de rede), mesma lista ao recarregar, painel coletivo, sem sequências nem ranking', 'docs/08 §2 e §4, docs/09 §1', async () => {
  const a = await reg('ms');
  const m1 = await missionsOf(a);
  eq([m1.enabled, m1.missions.length, m1.timezone], [true, 4, 'America/Sao_Paulo'], 'estrutura do dia');
  const fam = m1.missions.map((x) => x.family).sort();
  eq(fam, ['engajamento', 'engajamento', 'rede', 'rede'], 'famílias');
  check(m1.missions.every((x) => Number.isInteger(x.reward) && x.reward >= 1 && x.reward <= 4 && x.title && x.why), 'cada missão precisa de título, motivo e recompensa de 1 a 4');
  check(/^\d{4}-\d{2}-\d{2}$/.test(m1.day), `dia: ${m1.day}`);
  eq(m1.token.balance, 3, 'saldo de boas-vindas');
  const m2 = await missionsOf(a);
  eq(m2.missions.map((x) => x.id), m1.missions.map((x) => x.id), 'recarregar não pode sortear de novo');
  for (const k of ['novos_membros_semana', 'recebidos_semana', 'perguntas_respondidas_hoje', 'grupos_ativos_hoje', 'convites_aceitos_semana']) check(k in m1.collective, `painel coletivo sem "${k}"`);
  check(!/streak|ranking|nivel|level/i.test(JSON.stringify(Object.keys(m1.missions[0]))), 'missões não podem ter sequência, nível ou ranking');
  return { detail: '4 missões estáveis', docNote: 'docs/08 §3 diz "até 3 missões" e o diagrama "pega as 3 primeiras", mas o app entrega 4 por dia (2+2), como o resto do documento e docs/09' };
});

sim('Missões e token', '"Apresente-se" vem primeiro para conta nova, paga 2 NWC uma vez e o saldo bate com o extrato', 'docs/08 §3, docs/09 §1 (extrato imutável)', async () => {
  const a = await reg('ap');
  const m1 = await missionsOf(a);
  eq(m1.missions[0].id, 'apresentar', 'primeira missão de uma conta nova');
  eq(find(m1, 'apresentar').status, 'todo', 'status inicial');
  await post(a, 'Oi, sou nova por aqui e gosto de ciclovias.');
  const m2 = await missionsOf(a);
  eq(find(m2, 'apresentar').status, 'done', 'depois de postar');
  eq([m2.token.balance, m2.token.earned_now, m2.token.earned_today], [5, 2, 2], 'saldo, ganho agora e ganho hoje');
  for (let i = 0; i < 3; i++) eq((await missionsOf(a)).token.balance, 5, 'abrir de novo não paga outra vez');
  const w = await wallet(a);
  eq(w.ledger.reduce((s, e) => s + e.amount, 0), w.balance, 'saldo = soma do extrato');
  eq(w.ledger.map((e) => e.kind).sort(), ['grant', 'mission'], 'tipos do extrato');
  eq([w.totals.from_missions, w.totals.received, w.totals.given], [2, 0, 0], 'totais da carteira');
  status(await call(null, 'GET', '/api/carteira'), 401, 'carteira sem login');
});

sim('Missões e token', '"Curta 5 posts": exige 3 pessoas diferentes; curtir os próprios posts não conta', 'docs/09 §2 (engajamento)', async () => {
  const a = await userWithMission('curtir');
  const autores = [await reg('cu'), await reg('cu'), await reg('cu')];
  const feitos = [];
  for (const [i, au] of autores.entries()) for (let k = 0; k < (i === 0 ? 5 : 2); k++) feitos.push({ au, p: await post(au, `post ${i}-${k}`) });
  const meu = await post(a, 'meu próprio post');
  await like(a, meu.id);
  for (const f of feitos.filter((x) => x.au === autores[0]).slice(0, 5)) await like(a, f.p.id);
  let m = find(await missionsOf(a), 'curtir');
  eq([m.progress.current, m.progress.authors, m.status], [5, 1, 'todo'], '5 curtidas de uma só pessoa (e uma no próprio post)');
  await like(a, feitos.find((x) => x.au === autores[1]).p.id);
  await like(a, feitos.find((x) => x.au === autores[2]).p.id);
  const dia = await missionsOf(a);
  m = find(dia, 'curtir');
  eq([m.status, m.progress.authors >= 3], ['done', true], 'com 3 pessoas diferentes');
  check(dia.token.earned_today >= 2, 'a recompensa de 2 NWC deveria estar creditada');
});

sim('Missões e token', '"Comente 3 posts": respostas de pelo menos 15 caracteres, em posts de outras pessoas', 'docs/09 §2 (engajamento)', async () => {
  const a = await userWithMission('comentar');
  const b = await reg('co');
  const alvos = [];
  for (let i = 0; i < 4; i++) alvos.push(await post(b, `post alvo número ${i}`));
  for (let i = 0; i < 3; i++) await post(a, 'curta demais', alvos[i].id);
  eq(find(await missionsOf(a), 'comentar').progress.current, 0, 'respostas de 12 caracteres');
  const meu = await post(a, 'meu post para responder a mim mesma');
  for (let i = 0; i < 3; i++) await post(a, 'resposta longa o bastante a mim', meu.id);
  eq(find(await missionsOf(a), 'comentar').progress.current, 0, 'responder aos próprios posts');
  for (let i = 0; i < 3; i++) await post(a, 'uma resposta com mais de quinze caracteres', alvos[i].id);
  const m = find(await missionsOf(a), 'comentar');
  eq([m.status, m.progress.current], ['done', 3], 'depois de 3 respostas boas');
});

sim('Missões e token', 'Recompensar post: transfere 1 NWC, uma vez por post, nunca o próprio, nunca sem saldo', 'docs/09 §1 e §4', async () => {
  const a = await reg('tp');
  const b = await reg('tp');
  const ps = [];
  for (let i = 0; i < 4; i++) ps.push(await post(b, `post ${i}`));
  const minha = await post(a, 'meu post');
  status(await call(a.tok, 'POST', `/api/posts/${minha.id}/recompensa`), 409, 'recompensar o próprio post');
  const r = await call(a.tok, 'POST', `/api/posts/${ps[0].id}/recompensa`);
  status(r, 200, 'recompensar');
  eq([r.j.data.public_metrics.tip_count, r.j.data.viewer.tipped], [1, true], 'tip_count e viewer.tipped');
  eq([(await wallet(a)).balance, (await wallet(b)).balance], [2, 4], 'saldos depois da transferência');
  await call(a.tok, 'POST', `/api/posts/${ps[0].id}/recompensa`);
  eq((await wallet(a)).balance, 2, 'segunda recompensa no mesmo post não cobra');
  await call(a.tok, 'POST', `/api/posts/${ps[1].id}/recompensa`);
  await call(a.tok, 'POST', `/api/posts/${ps[2].id}/recompensa`);
  const sem = await call(a.tok, 'POST', `/api/posts/${ps[3].id}/recompensa`);
  status(sem, 409, 'sem saldo');
  check(/Saldo insuficiente/.test(sem.j.error), `mensagem: ${sem.j.error}`);
  const w = await wallet(a);
  eq([w.balance, w.totals.given], [0, 3], 'saldo zerado e total dado');
  eq((await wallet(b)).totals.received, 3, 'total recebido pela B');
  const total = (await wallet(a)).balance + (await wallet(b)).balance;
  eq(total, 3 + 3, 'o total em circulação entre as duas contas (3 + 3 de boas-vindas) não muda: a recompensa só transfere');
  const aut = await call(a.tok, 'POST', `/api/posts/${ps[3].id}/recompensa`);
  check(aut.s === 409, 'com saldo zero, nada é registrado');
  eq((await getPost(a, ps[3].id)).j.data.public_metrics.tip_count, 0, 'nenhuma recompensa registrada no post sem saldo');
});

sim('Missões e token', 'No máximo 20 recompensas por dia', 'docs/09 §1 (limites)', async () => {
  const a = await reg('t20');
  const b = await reg('t20');
  await wallet(a);
  sql(`UPDATE token_balances SET balance = 50 WHERE user_id = ${a.id}`);
  const ps = [];
  for (let i = 0; i < 21; i++) ps.push(await post(b, `post ${i}`));
  for (let i = 0; i < 20; i++) status(await call(a.tok, 'POST', `/api/posts/${ps[i].id}/recompensa`), 200, `recompensa ${i + 1}`);
  const r = await call(a.tok, 'POST', `/api/posts/${ps[20].id}/recompensa`);
  status(r, 409, '21ª recompensa');
  check(/20/.test(r.j.error), `a mensagem deveria citar o limite: ${r.j.error}`);
  eq((await wallet(a)).balance, 30, 'saldo depois de 20 recompensas');
});

sim('Missões e token', 'Evaporação: conta parada 3 dias perde parte do saldo ao voltar; em 7 dias zera; rodar duas vezes não desconta duas vezes', 'docs/09 (Evaporação)', async () => {
  state.base = cfg.base;
  const a = await reg('ev');
  const lim = cfg.limited;
  await wallet(a);
  sql(`UPDATE token_balances SET balance = 14, evaporated_days = 0 WHERE user_id = ${a.id}`);
  sql(`UPDATE users SET last_active_at = now() - interval '3 days 1 hour' WHERE id = ${a.id}`);
  // "Voltar ao app": entrar por outro processo (sem o limite de 5 min do processo que cadastrou).
  const l = await login(a.email, PASSWORD, { base: lim });
  status(l, 200, 'voltar ao app');
  const w = await call(l.j.token, 'GET', '/api/carteira', undefined, { base: lim });
  eq(w.j.balance, 8, 'saldo depois de 3 dias parada (14 → 12 → 10 → 8)');
  eq(w.j.totals.evaporated, 6, 'total evaporado');
  eq([w.j.ledger[0].kind, w.j.ledger[0].amount], ['evaporated', -6], 'linha do extrato');
  eq(sql(`SELECT count(*) FROM users WHERE id = ${a.id} AND last_active_at > now() - interval '1 minute'`), '1', 'voltar marca o uso');
  // Rotina de hora em hora, com a conta parada por 7 dias.
  sql(`UPDATE users SET last_active_at = now() - interval '7 days 1 hour' WHERE id = ${a.id}`);
  sql(`UPDATE token_balances SET evaporated_days = 0 WHERE user_id = ${a.id}`);
  const job = () => JSON.parse(execFileSync('node', ['-e', "import('./src/services/evaporation.js').then(async (m) => { console.log(JSON.stringify(await m.evaporate())); process.exit(0); })"], { cwd: BACKEND, encoding: 'utf8' }).trim().split('\n').pop());
  const r1 = job().find((x) => String(x.user_id) === String(a.id));
  eq([r1.burned, r1.days], [8, 7], 'a rotina zera o saldo no 7º dia');
  eq(sql(`SELECT balance FROM token_balances WHERE user_id = ${a.id}`), '0', 'saldo zerado');
  check(!job().some((x) => String(x.user_id) === String(a.id)), 'rodar de novo no mesmo dia não pode descontar outra vez');
  const total = sql(`SELECT -sum(amount) FROM token_ledger WHERE user_id = ${a.id} AND kind = 'evaporated'`);
  eq(total, '14', 'o extrato soma tudo o que evaporou');
});

sim('Missões e token', 'Pular missão não custa nada, esconder missões funciona, tempo no app conta 1 minuto a cada 55 s e pode ser desligado', 'docs/08 §2, docs/09 §3', async () => {
  const a = await reg('sk');
  const m = await missionsOf(a);
  const id = m.missions[1].id;
  status(await call(a.tok, 'POST', `/api/missoes/${id}/pular`), 200, 'pular');
  eq(find(await missionsOf(a), id).status, 'skipped', 'status depois de pular');
  status(await call(a.tok, 'POST', '/api/missoes/inexistente/pular'), 404, 'pular missão inexistente');
  const b1 = await call(a.tok, 'POST', '/api/atividade');
  eq([b1.j.counted, b1.j.minutes], [true, 1], 'primeiro sinal');
  const b2 = await call(a.tok, 'POST', '/api/atividade');
  eq(b2.j.minutes, 1, 'segundo sinal logo em seguida não conta');
  await call(a.tok, 'PUT', '/api/feed/preferencias', { count_time: false });
  eq((await call(a.tok, 'POST', '/api/atividade')).j, { counted: false, minutes: 0 }, 'com a contagem desligada');
  await call(a.tok, 'PUT', '/api/feed/preferencias', { missions_enabled: false });
  const off = await missionsOf(a);
  eq([off.enabled, off.missions], [false, []], 'missões escondidas');
  await call(a.tok, 'PUT', '/api/feed/preferencias', { missions_enabled: true });
  eq((await missionsOf(a)).enabled, true, 'missões de volta');
});

sim('Missões e token', '"Abra um espaço": só um grupo conta (canal de transmissão não) e paga 4 NWC', 'docs/08 §3', async () => {
  const a = await userWithMission('organizar');
  const mk = (kind) => call(a.tok, 'POST', '/api/channels', { slug: `o${Math.random().toString(36).slice(2, 9)}`, title: 'Espaço', kind });
  await mk('channel');
  eq(find(await missionsOf(a), 'organizar').status, 'todo', 'depois de criar um canal de transmissão');
  await mk('group');
  const m = await missionsOf(a);
  eq(find(m, 'organizar').status, 'done', 'depois de criar um grupo');
  check(m.token.earned_today >= 4, 'deveria ter ganhado 4 NWC');
});

sim('Missões e token', '"Traga alguém de confiança": conta quando o convite é usado e paga 4 NWC', 'docs/08 §3 e §5', async () => {
  const a = await userWithMission('convidar');
  const inv = (await call(a.tok, 'POST', '/api/convites')).j.data;
  eq(find(await missionsOf(a), 'convidar').status, 'todo', 'convite gerado mas não usado');
  const u = 'cv' + Math.random().toString(36).slice(2, 8);
  status(await call(null, 'POST', '/api/auth/register', { username: u, email: `${u}@sim.test`, password: PASSWORD, accept_rules: true, invite_code: inv.code }), 201, 'a pessoa convidada entra');
  const m = await missionsOf(a);
  eq(find(m, 'convidar').status, 'done', 'depois de usar o convite');
  check(m.token.earned_today >= 4, 'deveria ter ganhado 4 NWC');
  check(m.collective.convites_aceitos_semana >= 1, 'o painel coletivo deveria contar o convite aceito');
});

// ---------------------------------------------------------------- Brasil em dados
sim('Brasil em dados', '5 indicadores com os últimos números conferidos e 5 anos de histórico, abertos a visitantes', 'docs/13 §13, README', async () => {
  const r = await call(null, 'GET', '/api/dados');
  status(r, 200, 'sem login');
  const d = r.j.data;
  eq([d.mode, d.checked_at], ['registro', '2026-10-29'], 'modo e data da conferência');
  const by = Object.fromEntries(d.indicators.map((i) => [i.id, i]));
  eq(Object.keys(by).sort(), ['comida', 'economia', 'emprego', 'inflacao', 'juros'], 'indicadores');
  const esperado = { inflacao: [4.58, '202609', 'fonte_unica'], comida: [922.51, '202609', 'parcial'], emprego: [5.3, '202608', 'fonte_unica'], economia: [2, '2026T2', 'confirmado'], juros: [13.75, '202609', 'fonte_unica'] };
  for (const [id, [v, per, selo]] of Object.entries(esperado)) eq([by[id].latest.value, by[id].latest.period, by[id].badge], [v, per, selo], `${id}: valor, período e selo`);
  const anos = { inflacao: ['202112', 10.06], comida: ['202112', 690.51], emprego: ['202112', 11.1], economia: ['2021T4', 1.6], juros: ['202112', 9.25] };
  for (const [id, [per, v]] of Object.entries(anos)) {
    const h = by[id].history;
    eq([h[0].period, h[0].value], [per, v], `${id}: ponto mais antigo (5 anos atrás)`);
    check(h.slice(1).every((p, i) => p.period > h[i].period), `${id}: histórico fora de ordem`);
    check(h.filter((p) => /^202[1-5](12|T4)$/.test(p.period)).length === 5, `${id}: deveria ter um ponto por ano de 2021 a 2025`);
  }
  check(d.indicators.every((i) => i.title && i.why && ['confirmado', 'fonte_unica', 'divergencia', 'desatualizado', 'parcial', 'sem_dados'].includes(i.badge)), 'título, motivo e selo válidos');
});

sim('Brasil em dados', 'Cada origem traz publicação, data e links de conferência; o que não foi conferido aparece como tal (nada inventado)', 'docs/13 §13', async () => {
  const d = (await call(null, 'GET', '/api/dados')).j.data;
  for (const i of d.indicators) {
    const o = i.sources.find((s) => s.role === 'origem');
    check(o.latest && o.registro && /^https:\/\//.test(o.registro.url) && o.registro.published && o.registro.evidence.length > 0, `${i.id}: a origem precisa de publicação, data e onde mais foi conferida`);
    check(o.registro.history_evidence.length > 0, `${i.id}: faltam os links do histórico de 5 anos`);
  }
  const inf = d.indicators.find((i) => i.id === 'inflacao');
  check(inf.notes.some((n) => /cópia do Banco Central ainda não foi conferida/.test(n)), 'a cópia não conferida do Banco Central deveria estar dita');
  const cesta = d.indicators.find((i) => i.id === 'comida');
  const indep = cesta.sources.find((s) => s.role === 'independente');
  eq(indep.latest, null, 'a fonte independente da cesta não tem número confirmado, e não pode ter um inventado');
  const eco = d.indicators.find((i) => i.id === 'economia');
  eq(eco.sources.find((s) => s.role === 'independente').latest.value, 1.2, 'IBC-Br de agosto');
  check(!JSON.stringify(d).includes('NaN') && !JSON.stringify(d).includes('undefined'), 'valores inválidos na resposta');
});

sim('Brasil em dados', 'Indicador inexistente é recusado; forçar atualização é só da moderação e não apaga o que foi conferido', 'docs/13 §12', async () => {
  const a = await reg('bd');
  const m = await mod();
  status(await call(null, 'GET', '/api/dados/inflacao'), 200, 'indicador existente');
  status(await call(null, 'GET', '/api/dados/xyz'), 400, 'indicador inexistente');
  status(await call(null, 'POST', '/api/moderacao/dados/atualizar'), 401, 'sem login');
  status(await call(a.tok, 'POST', '/api/moderacao/dados/atualizar'), 403, 'pessoa comum');
  const antes = (await call(null, 'GET', '/api/dados')).j.data.indicators.map((i) => [i.id, i.latest.value]);
  const r = await call(m.tok, 'POST', '/api/moderacao/dados/atualizar');
  status(r, 200, 'moderação forçando a atualização');
  check(Array.isArray(r.j.data) && r.j.data.length === 9, `deveria listar as 9 fontes, listou ${r.j.data?.length}`);
  const depois = (await call(null, 'GET', '/api/dados')).j.data.indicators.map((i) => [i.id, i.latest.value]);
  eq(depois, antes, 'uma falha de rede não pode apagar o último dado bom');
  const falhas = r.j.data.filter((x) => !x.ok).length;
  return `${falhas} de 9 fontes sem resposta (esperado: este ambiente não alcança IBGE, Banco Central nem DIEESE); números intactos`;
});

// ---------------------------------------------------------------- Federação
sim('Federação', 'WebFinger e NodeInfo: handle usuario@instancia, domínio e formato validados', 'README, docs/03 §4', async () => {
  const a = await reg('wf');
  const ok = await call(null, 'GET', `/.well-known/webfinger?resource=acct:${a.u}@localhost:4020`);
  status(ok, 200, 'webfinger');
  check(/jrd\+json/.test(ok.h.get('content-type')), `content-type: ${ok.h.get('content-type')}`);
  eq(ok.j.links.find((l) => l.rel === 'self').href, `http://localhost:4020/federation/users/${a.u}`, 'link do ator');
  status(await call(null, 'GET', `/.well-known/webfinger?resource=acct:${a.u}@outra.instancia`), 404, 'domínio de outra instância');
  status(await call(null, 'GET', `/.well-known/webfinger?resource=${a.u}`), 400, 'formato inválido');
  status(await call(null, 'GET', '/.well-known/webfinger?resource=acct:ninguem_aqui@localhost:4020'), 404, 'usuário inexistente');
  const ni = await call(null, 'GET', '/.well-known/nodeinfo');
  status(ni, 200, 'nodeinfo');
  eq([ni.j.software.name, ni.j.openRegistrations], ['agora', true], 'nodeinfo');
});

sim('Federação', 'Ator e outbox ActivityStreams: Create/Note com o texto escapado, até 20, sem reposts', 'docs/03 §4, docs/14 F-1', async () => {
  const a = await reg('ob');
  const b = await reg('ob');
  const actor = await call(null, 'GET', `/federation/users/${a.u}`);
  status(actor, 200, 'ator');
  eq([actor.j.type, actor.j.preferredUsername], ['Person', a.u], 'ator');
  for (let i = 0; i < 22; i++) await post(a, i === 21 ? '<b>oi</b> & "tchau"' : `post ${i}`);
  const p = await post(b, 'post da B');
  await call(a.tok, 'POST', `/api/posts/${p.id}/repost`);
  const o = await call(null, 'GET', `/federation/users/${a.u}/outbox`);
  status(o, 200, 'outbox');
  eq([o.j.type, o.j.totalItems, o.j.orderedItems.length], ['OrderedCollection', 20, 20], 'até 20 itens');
  eq(o.j.orderedItems[0].object.content, '<p>&lt;b&gt;oi&lt;/b&gt; &amp; &quot;tchau&quot;</p>', 'texto escapado como HTML');
  check(o.j.orderedItems.every((x) => x.type === 'Create' && x.object.type === 'Note' && x.object.attributedTo.endsWith(`/federation/users/${a.u}`)), 'formato Create/Note');
  check(!o.j.orderedItems.some((x) => /post da B/.test(x.object.content)), 'reposts não entram no outbox');
  status(await call(null, 'GET', '/federation/users/ninguem_aqui'), 404, 'ator inexistente');
});

// ---------------------------------------------------------------- Segurança e limites
sim('Segurança e limites', 'Cabeçalhos de proteção na API, nada de x-powered-by, login sem cache e CORS só para a origem do app', 'docs/10 M7', async () => {
  const r = await call(null, 'GET', '/api/health');
  const h = (k) => r.h.get(k);
  check(/default-src 'none'/.test(h('content-security-policy')) && /frame-ancestors 'none'/.test(h('content-security-policy')), `CSP: ${h('content-security-policy')}`);
  eq([h('x-content-type-options'), h('x-frame-options'), h('referrer-policy')], ['nosniff', 'DENY', 'no-referrer'], 'cabeçalhos');
  check(!h('x-powered-by'), 'x-powered-by deveria estar desligado');
  const l = await call(null, 'POST', '/api/auth/login', { email: 'x@y.zz', password: 'abc' });
  eq(l.h.get('cache-control'), 'no-store', 'login sem cache');
  const ok = await call(null, 'GET', '/api/health', undefined, { headers: { origin: 'http://localhost:5173' } });
  eq(ok.h.get('access-control-allow-origin'), 'http://localhost:5173', 'CORS para o app');
  const ruim = await call(null, 'GET', '/api/health', undefined, { headers: { origin: 'http://site-malicioso.example' } });
  const liberado = ruim.h.get('access-control-allow-origin');
  check(liberado !== 'http://site-malicioso.example' && liberado !== '*', `CORS não pode liberar outra origem nem usar curinga: ${liberado}`);
});

sim('Segurança e limites', 'Parâmetros estranhos (aspas, ponto e vírgula, números gigantes, unicode) nunca derrubam a API nem mexem no banco', 'docs/10', async () => {
  const a = await reg('fz');
  const antes = sql('SELECT count(*) FROM users');
  const lixo = ["' OR 1=1--", "1; DROP TABLE users;--", '99999999999999999999999', '%00', '../../etc/passwd', '😀😀😀', 'a'.repeat(3000), '{{7*7}}', '<script>alert(1)</script>'];
  for (const x of lixo) {
    const e = encodeURIComponent(x);
    for (const [m, path] of [['GET', `/api/posts/${e}`], ['GET', `/api/users/${e}`], ['GET', `/api/users?q=${e}`], ['GET', `/api/channels/${e}`], ['GET', `/api/posts?until_id=${e}`], ['GET', `/api/timeline?max_results=${e}`], ['GET', `/api/dados/${e}`], ['POST', `/api/posts/${e}/like`], ['GET', `/federation/users/${e}`], ['GET', `/.well-known/webfinger?resource=${e}`]]) {
      const r = await call(a.tok, m, path);
      check(r.s < 500, `${m} ${path.slice(0, 40)}: veio ${r.s}`);
    }
  }
  const t = await call(a.tok, 'POST', '/api/posts', { text: "texto com ' aspas \" e <tags> e ; ponto e vírgula" });
  status(t, 201, 'texto com caracteres especiais');
  eq(t.j.data.text, "texto com ' aspas \" e <tags> e ; ponto e vírgula", 'o texto volta exatamente como foi enviado');
  eq(sql('SELECT count(*) FROM users'), String(Number(antes)), 'nenhuma conta foi criada ou apagada');
  eq(sql("SELECT to_regclass('users') IS NOT NULL"), 't', 'a tabela users continua existindo');
});

sim('Segurança e limites', 'Limite de pedidos: cabeçalhos no padrão do X, contador por pessoa que desce 1 a cada pedido', 'docs/10 A3', async () => {
  state.base = cfg.limited;
  const a = await reg('rl', { base: cfg.limited });
  const b = await reg('rl', { base: cfg.limited });
  const g1 = await call(a.tok, 'GET', '/api/users/' + a.u);
  const g2 = await call(a.tok, 'GET', '/api/users/' + a.u);
  eq([g1.h.get('x-rate-limit-limit'), Number(g1.h.get('x-rate-limit-remaining')) - Number(g2.h.get('x-rate-limit-remaining'))], ['600', 1], 'limite e desconto por pedido');
  check(Number(g1.h.get('x-rate-limit-reset')) > Date.now() / 1000, 'x-rate-limit-reset deveria estar no futuro');
  const outra = await call(b.tok, 'GET', '/api/users/' + b.u);
  check(Number(outra.h.get('x-rate-limit-remaining')) > Number(g2.h.get('x-rate-limit-remaining')) - 5, 'cada pessoa tem o próprio contador');
}, { limited: true });

sim('Segurança e limites', 'Senhas erradas: 10 por conta bloqueiam a 11ª tentativa (mesmo com a senha certa); outra conta segue livre', 'docs/14 A-4', async () => {
  state.base = cfg.limited;
  const a = await reg('lk', { base: cfg.limited });
  const b = await reg('lk', { base: cfg.limited });
  for (let i = 0; i < 10; i++) status(await login(a.email, `errada-${i}-xyz`, { base: cfg.limited }), 401, `tentativa errada ${i + 1}`);
  const bloq = await login(a.email, PASSWORD, { base: cfg.limited });
  status(bloq, 429, 'tentativa certa depois de 10 erradas');
  check(Number(bloq.h.get('retry-after')) > 0, 'faltou o cabeçalho retry-after');
  status(await login(b.email, PASSWORD, { base: cfg.limited }), 200, 'outra conta');
}, { limited: true });

sim('Segurança e limites', 'Limite de tentativas de entrada por IP: depois de 20, responde 429 com o tempo de espera', 'docs/10 A3, docs/14 A-3', async () => {
  state.base = cfg.limited;
  let r;
  let n = 0;
  for (; n < 25; n++) {
    r = await call(null, 'POST', '/api/auth/login', { email: `ninguem${n}@sim.test`, password: 'abc12345' }, { base: cfg.limited });
    if (r.s === 429) break;
  }
  status(r, 429, 'limite de entrada por IP');
  check(n <= 21 && r.j.retry_after > 0, `o limite deveria valer em 20 tentativas (parou em ${n}); retry_after=${r.j?.retry_after}`);
  eq(r.j.error, 'Too Many Requests', 'mensagem');
  return `bloqueou na tentativa ${n + 1}`;
}, { limited: true, last: true });
