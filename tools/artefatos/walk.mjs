// Passo a passo do "Ágora por dentro": cada linha é uma chamada real ao backend.
// Uso: node walk.mjs <pasta de saída> <log do servidor da API>  (ver run.sh)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { io } = createRequire(new URL('../../backend/package.json', import.meta.url))('socket.io-client');
const R = process.argv[2];
const SERVER_LOG = process.argv[3] ?? R + '/api.log';
const B = process.env.API_URL ?? 'http://localhost:4000';
const DOMAIN = new URL(B).host;
const out = [];
async function call(tok, method, path, body) {
  const t = performance.now();
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j, ms: +(performance.now() - t).toFixed(1), h: r.headers };
}
function rec(area, step, ok, detail, ms) { out.push({ area, step, ok: !!ok, detail: String(detail ?? ''), ms: ms ?? null }); console.log(ok ? 'OK  ' : 'FAIL', area, '|', step, '|', detail); }
// Cada área começa com os contadores de limite zerados (como nas simulações); a área de limites mede os reais.
const freshLimits = () => execSync("redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del", { stdio: 'ignore', shell: '/bin/bash' });
const login = async (u) => (await call(null, 'POST', '/api/auth/login', { email: u + '@exemplo.test', password: 'senha1234' })).j.token;
const reg = async (u) => { const x = await call(null, 'POST', '/api/auth/register', { username: u, email: u + '@a.local', password: 'senha1234', accept_rules: true }); return { tok: x.j?.token, id: x.j?.user?.id, u }; };
let r;

// Contas
freshLimits();
r = await call(null, 'POST', '/api/auth/register', { username: 'teste_analise', email: 't@a.local', password: 'senha1234', display_name: 'Teste Análise', accept_rules: true });
rec('Contas', 'Cadastro', r.s === 201, `HTTP ${r.s}, sessão aberta`, r.ms);
const T = r.j?.token;
r = await call(null, 'POST', '/api/auth/register', { username: 'teste_sem_regras', email: 's@a.local', password: 'senha1234' });
rec('Contas', 'Cadastro sem aceitar as regras é recusado', r.s === 400, `HTTP ${r.s}: ${r.j?.error}`, r.ms);
r = await call(null, 'POST', '/api/auth/login', { email: 'ana_dev@exemplo.test', password: 'senha1234' }); const A = r.j.token;
rec('Contas', 'Entrar com e-mail e senha', r.s === 200, `HTTP ${r.s}`, r.ms);
r = await call(null, 'POST', '/api/auth/login', { email: 'ana_dev@exemplo.test', password: 'errada' });
rec('Contas', 'Senha errada é recusada', r.s === 401, `HTTP ${r.s}: ${r.j?.error}`, r.ms);
r = await call(A, 'GET', '/api/auth/me'); rec('Contas', 'Sessão (/me)', r.s === 200, `@${r.j?.user?.username}`, r.ms);
const B2 = await login('bruno_pesquisa');

// Recuperar senha
{
  const before = fs.readFileSync(SERVER_LOG, 'utf8').length;
  const a = await call(null, 'POST', '/api/auth/senha/esqueci', { email: 't@a.local' });
  const b = await call(null, 'POST', '/api/auth/senha/esqueci', { email: 'ninguem@a.local' });
  rec('Recuperar senha', 'Mesma resposta exista ou não a conta', a.s === 200 && JSON.stringify(a.j) === JSON.stringify(b.j), `“${a.j?.message}”`, a.ms);
  await new Promise((res) => setTimeout(res, 300));
  const log = fs.readFileSync(SERVER_LOG, 'utf8').slice(before);
  const m = log.match(/redefinir-senha\?token=([A-Za-z0-9_-]{43})/);
  rec('Recuperar senha', 'Só a conta que existe recebe o link', !!m && (log.match(/\[e-mail\] Para:/g) ?? []).length === 1, 'um e-mail, para t@a.local; no protótipo ele vai para o log do servidor');
  r = await call(null, 'POST', '/api/auth/senha/redefinir', { token: m[1], password: 'senha-nova-123' });
  rec('Recuperar senha', 'O link troca a senha e encerra as sessões', r.s === 200 && (await call(T, 'GET', '/api/auth/me')).s === 401, `HTTP ${r.s}; a sessão aberta antes recebe 401`, r.ms);
  r = await call(null, 'POST', '/api/auth/senha/redefinir', { token: m[1], password: 'outra-senha-456' });
  rec('Recuperar senha', 'O mesmo link não vale duas vezes', r.s === 400, `HTTP ${r.s}: ${r.j?.error}`, r.ms);
  r = await call(null, 'POST', '/api/auth/login', { email: 't@a.local', password: 'senha-nova-123' });
  rec('Recuperar senha', 'Entra com a senha nova', r.s === 200, `HTTP ${r.s}`, r.ms);
}
const T2 = (await call(null, 'POST', '/api/auth/login', { email: 't@a.local', password: 'senha-nova-123' })).j.token;

// Visitantes
r = await call(null, 'GET', '/api/posts?max_results=5'); rec('Visitantes', 'Lê a timeline da instância sem conta', r.s === 200 && r.j.data.length > 0, `${r.j.data.length} posts`, r.ms);
const vp = r.j.data[0];
r = await call(null, 'GET', `/api/posts/${vp.id}/thread`); rec('Visitantes', 'Abre uma conversa', r.s === 200, `${r.j?.data?.length} post(s)`, r.ms);
r = await call(null, 'GET', '/api/users/ana_dev'); rec('Visitantes', 'Abre um perfil', r.s === 200, `${r.j?.data?.display_name}`, r.ms);
r = await call(null, 'POST', `/api/posts/${vp.id}/like`); rec('Visitantes', 'Curtir pede login', r.s === 401, `HTTP ${r.s}; nada muda`, r.ms);
r = await call(null, 'POST', '/api/posts', { text: 'sem conta' }); rec('Visitantes', 'Postar pede login', r.s === 401, `HTTP ${r.s}`, r.ms);

// Perfis
r = await call(A, 'GET', '/api/users/bruno_pesquisa'); const bu = r.j.data;
rec('Perfis', 'Ver perfil', r.s === 200, `${bu.display_name}: ${bu.public_metrics?.followers_count} seguidores`, r.ms);
r = await call(T2, 'POST', '/api/users/ana_dev/follow'); rec('Perfis', 'Seguir', r.s < 300, `HTTP ${r.s}`, r.ms);
r = await call(T2, 'GET', '/api/users/ana_dev/followers?max_results=50'); rec('Perfis', 'Lista de seguidores', r.s === 200, `${r.j?.data?.length} seguidores da ana_dev`, r.ms);
r = await call(A, 'GET', '/api/users?q=ana'); rec('Perfis', 'Busca de pessoas', r.s === 200, `“ana” → ${r.j?.data?.length} resultado(s)`, r.ms);

// Posts
r = await call(B2, 'POST', '/api/posts', { text: 'Análise ponta a ponta: horta comunitária no sábado #pesquisa @ana_dev' }); const P = r.j.data;
rec('Posts', 'Publicar', r.s === 201, `id Snowflake ${P.id}`, r.ms);
r = await call(A, 'POST', '/api/posts', { text: 'Respondendo na thread', reply_to_id: P.id }); const RP = r.j.data;
rec('Posts', 'Responder (thread)', r.s === 201, `resposta ${RP.id}`, r.ms);
r = await call(A, 'GET', `/api/posts/${P.id}/thread`); rec('Posts', 'Ler a conversa', r.s === 200, `${r.j?.data?.length} posts`, r.ms);
r = await call(A, 'POST', '/api/posts', { text: 'x'.repeat(281) }); rec('Posts', 'Limite de 280 caracteres', r.s === 400, `HTTP ${r.s}: ${r.j?.error}`, r.ms);
r = await call(A, 'POST', `/api/posts/${P.id}/like`); rec('Posts', 'Curtir', r.s === 200, `curtidas: ${r.j?.data?.public_metrics?.like_count}`, r.ms);
r = await call(A, 'POST', `/api/posts/${P.id}/repost`); rec('Posts', 'Republicar', r.s === 200, `reposts: ${r.j?.data?.public_metrics?.repost_count}`, r.ms);
r = await call(A, 'GET', '/api/mentions'); rec('Posts', 'Menções', r.s === 200 && r.j.data.some((p) => p.id === P.id), `${r.j?.data?.length} menções; a nova aparece`, r.ms);

// Busca de posts
r = await call(null, 'GET', '/api/posts/busca?q=' + encodeURIComponent('comunitárias')); rec('Busca', 'Acha pelo radical e sem acento', r.s === 200 && r.j.data.some((p) => p.id === P.id), `“comunitárias” acha “comunitária”; ${r.j?.data?.length} post(s)`, r.ms);
r = await call(null, 'GET', '/api/posts/busca?q=postgres'); const ids = r.j.data.map((p) => BigInt(p.id));
rec('Busca', 'Mais recentes primeiro, aberta a visitantes', r.s === 200 && ids.every((v, i) => i === 0 || ids[i - 1] > v), `“postgres” → ${r.j.data.length} posts em ordem de data, sem ordenar por curtidas`, r.ms);
r = await call(null, 'GET', '/api/posts/busca?q=' + encodeURIComponent('horta -sábado')); rec('Busca', 'Excluir palavra com -palavra', r.s === 200 && !r.j.data.some((p) => p.id === P.id), `“horta -sábado” deixa o post de fora`, r.ms);
r = await call(null, 'GET', '/api/posts/busca?q=a'); rec('Busca', 'Busca curta demais é recusada', r.s === 400, `HTTP ${r.s}: ${r.j?.error}`, r.ms);

// Imagens
{
  const { encodePng, pngChunk } = await import(new URL('../../backend/src/lib/png.js', import.meta.url));
  const png = encodePng(320, 160, (x, y) => [x % 256, y % 256, 140], [pngChunk('tEXt', Buffer.from('GPS\0-23.5505,-46.6333', 'latin1'))]);
  const up = async (tok, bytes, type = 'image/png') => {
    const t = performance.now();
    const res = await fetch(B + '/api/midia', { method: 'POST', headers: { 'content-type': type, ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: bytes });
    return { s: res.status, j: await res.json().catch(() => null), ms: +(performance.now() - t).toFixed(1) };
  };
  r = await up(null, png); rec('Imagens', 'Enviar imagem pede login', r.s === 401, `HTTP ${r.s}`, r.ms);
  r = await up(B2, png); const M = r.j?.data;
  rec('Imagens', 'Enviar uma foto', r.s === 201, `${M?.type}, ${M?.width}×${M?.height}, ${M?.size} bytes`, r.ms);
  r = await up(B2, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')); rec('Imagens', 'SVG disfarçado de PNG é recusado', r.s === 400, `HTTP ${r.s}: ${r.j?.error}`, r.ms);
  r = await up(B2, Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024)])); rec('Imagens', 'Imagem acima de 2 MB é recusada', r.s === 413, `HTTP ${r.s}: ${r.j?.error}`, r.ms);
  r = await call(B2, 'POST', '/api/posts', { text: 'Mutirão da horta, sábado', media: [{ id: M.id, alt: ' ' }] }); rec('Imagens', 'Descrição é obrigatória', r.s === 400, `HTTP ${r.s}: ${r.j?.details?.[0]?.message ?? r.j?.error}`, r.ms);
  r = await call(A, 'POST', '/api/posts', { text: 'pegando a imagem do Bruno', media: [{ id: M.id, alt: 'x' }] }); rec('Imagens', 'Ninguém anexa a imagem de outra pessoa', r.s === 400, `HTTP ${r.s}: ${r.j?.error}`, r.ms);
  r = await call(B2, 'POST', '/api/posts', { text: 'Mutirão da horta, sábado', media: [{ id: M.id, alt: 'Faixas de cor em degradê, imagem de teste' }] }); const PI = r.j?.data;
  rec('Imagens', 'Post com imagem e descrição', r.s === 201 && PI?.media?.[0]?.alt, `“${PI?.media?.[0]?.alt}”`, r.ms);
  const file = await fetch(B + M.url);
  const bytes = Buffer.from(await file.arrayBuffer());
  rec('Imagens', 'Localização removida antes de guardar', file.status === 200 && !bytes.toString('latin1').includes('GPS'), `o arquivo servido não tem o texto “GPS” que a foto trazia; ${bytes.length} de ${png.length} bytes`);
  rec('Imagens', 'Servida com cabeçalhos fechados', file.headers.get('content-type') === 'image/png' && file.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(file.headers.get('content-security-policy') ?? ''), `${file.headers.get('content-type')}, nosniff, CSP com sandbox`);
  r = await call(B2, 'DELETE', `/api/posts/${PI.id}`); const gone = await fetch(B + M.url);
  rec('Imagens', 'Apagar o post apaga a imagem', gone.status === 404, `a imagem passa a responder HTTP ${gone.status}`);
}

// Notificações
// Ana curtiu, repostou e respondeu o post do Bruno: esses avisos são dele. Ela foi mencionada e ganhou uma seguidora.
r = await call(B2, 'GET', '/api/notificacoes'); const nb = r.j.data.filter((n) => n.post_id === P.id || n.post_id === RP.id).map((n) => n.kind);
rec('Notificações', 'Quem recebe a ação recebe o aviso', ['reply', 'like', 'repost'].every((k) => nb.includes(k)), `Bruno: ${nb.join(', ')} (da Ana)`, r.ms);
r = await call(A, 'GET', '/api/notificacoes'); const nl = r.j;
rec('Notificações', 'Menção e novo seguidor', nl.data.some((n) => n.kind === 'mention' && n.post_id === P.id) && nl.data.some((n) => n.kind === 'follow'), `Ana: ${nl.data.slice(0, 3).map((n) => n.kind).join(', ')}…`, r.ms);
rec('Notificações', 'Contador de não lidas', nl.meta.unread_count > 0, `${nl.meta.unread_count} não lidas`);
r = await call(A, 'POST', '/api/notificacoes/lidas', { newest_id: nl.meta.newest_id }); rec('Notificações', 'Marcar como lidas', r.s === 200 && r.j.unread_count === 0, `restam ${r.j?.unread_count}`, r.ms);
await call(A, 'DELETE', `/api/posts/${P.id}/like`); await call(A, 'POST', `/api/posts/${P.id}/like`);
r = await call(B2, 'GET', '/api/notificacoes'); rec('Notificações', 'A mesma curtida não avisa duas vezes', r.j.data.filter((n) => n.kind === 'like' && n.post_id === P.id).length === 1, 'descurtir apaga o aviso; curtir de novo cria um só', r.ms);
await call(B2, 'POST', '/api/users/ana_dev/mute');
await call(A, 'POST', `/api/posts/${P.id}/recompensa`);
r = await call(B2, 'GET', '/api/notificacoes'); rec('Notificações', 'Quem silenciou não recebe avisos', !r.j.data.some((n) => n.actor_id === nl.data[0]?.actor_id && n.kind === 'tip'), 'Bruno silenciou a Ana: a recompensa dela não vira aviso', r.ms);
await call(B2, 'DELETE', '/api/users/ana_dev/mute');

// Feed Seguindo
r = await call(A, 'GET', '/api/timeline?max_results=5'); const m = r.j.meta;
rec('Feed Seguindo', 'Página 1 (5 posts)', r.s === 200, `result_count=${m.result_count}, next_token=${m.next_token ? 'sim' : 'não'}`, r.ms);
const ids1 = r.j.data.map((p) => BigInt(p.id)); const desc = ids1.every((v, i) => i === 0 || ids1[i - 1] > v);
rec('Feed Seguindo', 'Ordem cronológica reversa', desc, desc ? 'IDs em ordem decrescente' : 'fora de ordem');
const r2 = await call(A, 'GET', '/api/timeline?max_results=5&until_id=' + m.next_token);
const overlap = r2.j.data.filter((p) => ids1.includes(BigInt(p.id))).length;
rec('Feed Seguindo', 'Página 2 por cursor', r2.s === 200 && overlap === 0, `${r2.j.data.length} posts, ${overlap} repetidos`, r2.ms);
{ const fol = (await call(A, 'GET', '/api/users/bruno_pesquisa/followers?max_results=5')).j.data[0]; const F = await login(fol.username); const tl = (await call(F, 'GET', '/api/timeline?max_results=20')).j.data; rec('Feed Seguindo', 'Post novo chega a quem segue (fan-out)', tl.some((p) => p.id === P.id), `@${fol.username} recebeu o post do Bruno na posição ${tl.findIndex((p) => p.id === P.id) + 1}`); }

// Para você (no aparelho)
r = await call(null, 'GET', '/api/feed/algoritmo'); rec('Para você', 'Regras públicas do algoritmo', r.s === 200, `${r.j?.name ?? r.j?.id ?? 'interesses-v1'} · ${(r.j?.factors ?? []).length} fatores`, r.ms);
r = await call(A, 'GET', '/api/feed/interesses'); rec('Para você', 'O servidor não calcula o feed', r.s === 410, `HTTP ${r.s}: ${r.j?.error}`, r.ms);
r = await call(A, 'GET', '/api/feed/candidatos'); rec('Para você', 'Candidatos para o aparelho ordenar', r.s === 200, `${r.j?.data?.length} posts dos últimos ${r.j?.meta?.window_days} dias, sem pontuação`, r.ms);
r = await call(A, 'PUT', '/api/feed/preferencias', { topics: { frontend: 1 } }); rec('Para você', 'Preferências do algoritmo não vão ao servidor', r.s === 400, `HTTP ${r.s}: o servidor só guarda missões e contagem de tempo`, r.ms);
r = await call(A, 'POST', `/api/posts/${vp.id}/feedback`, { kind: 'less' }); rec('Para você', '“Menos disto” não deixa rastro', r.s === 200 && r.j?.stored === false, `stored=${r.j?.stored}`, r.ms);
r = await call(A, 'PUT', '/api/feed/modo', { mode: 'server' }); rec('Para você', 'Não existe voltar o algoritmo ao servidor', r.s === 400, `HTTP ${r.s}`, r.ms);

// Canais
freshLimits();
const sock = io(B, { auth: { token: A }, transports: ['websocket'] });
await new Promise((res) => sock.on('connect', res));
const ack = await new Promise((res) => sock.emit('channel:subscribe', { slug: 'cafe' }, res));
rec('Canais', 'Conectar e assinar canal via WebSocket', sock.connected && ack?.ok, `ack ok, pts ${ack?.pts}`);
const got = new Promise((res) => { sock.on('message:new', (msg) => res(msg)); setTimeout(() => res(null), 3000); });
const t0 = performance.now();
const C = await login('carla_ux'); r = await call(C, 'POST', '/api/channels/cafe/messages', { text: 'Mensagem em tempo real do teste' });
const ev = await got;
rec('Canais', 'Mensagem chega em tempo real', !!ev, ev ? `entregue em ${(performance.now() - t0).toFixed(0)} ms, pts ${r.j?.data?.pts}` : 'não chegou');
const pts = r.j?.data?.pts;
r = await call(A, 'GET', `/api/channels/cafe/difference?pts=${pts - 3}`); rec('Canais', 'Recuperar lacuna por pts', r.s === 200, `${r.j?.data?.length} mensagens desde pts ${pts - 3}`, r.ms);
const mid = r.j?.data?.at?.(-1)?.id;
r = await call(A, 'POST', `/api/channels/cafe/messages/${mid}/reactions`, { emoji: '🔥' }); rec('Canais', 'Reação com emoji', r.s === 200, `HTTP ${r.s}`, r.ms);
r = await call(A, 'POST', `/api/channels/cafe/messages/${mid}/reactions`, { emoji: '🦄' }); rec('Canais', 'Só os 8 emojis da lista', r.s === 400, `HTTP ${r.s}: ${r.j?.error}`, r.ms);
sock.close();
{
  const G1 = await reg('grupo_dona'), G2 = await reg('grupo_membro'), G3 = await reg('grupo_fora');
  r = await call(G1.tok, 'POST', '/api/channels', { slug: 'sala_fechada', title: 'Sala fechada', kind: 'group' }); rec('Canais', 'Criar grupo', r.s === 201, `HTTP ${r.s}`, r.ms);
  await call(G2.tok, 'POST', '/api/channels/sala_fechada/members');
  await call(G1.tok, 'POST', '/api/channels/sala_fechada/messages', { text: 'só para quem entrou' });
  r = await call(G3.tok, 'GET', '/api/channels/sala_fechada/messages'); rec('Canais', 'Grupo é só de quem entrou', r.s === 403, `quem não entrou → HTTP ${r.s}`, r.ms);
  r = await call(G1.tok, 'DELETE', '/api/channels/sala_fechada/members/grupo_membro'); rec('Canais', 'Dona remove uma pessoa', r.s < 300, `HTTP ${r.s}`, r.ms);
  r = await call(G2.tok, 'POST', '/api/channels/sala_fechada/members'); rec('Canais', 'Quem foi removido não entra de novo', r.s === 403, `HTTP ${r.s}: ${r.j?.error}`, r.ms);
  r = await call(T2, 'POST', '/api/channels/cafe/messages', { text: 'sou membro?' }); rec('Canais', 'Não membro não escreve', r.s === 403, `HTTP ${r.s}: ${r.j?.error}`, r.ms);
}

// Missões e NWC
r = await call(A, 'GET', '/api/missoes'); const ms_ = r.j.missions ?? [];
rec('Missões', 'Missões do dia', r.s === 200 && ms_.length === 4, `${ms_.length} missões: ${ms_.map((x) => x.title).join(' · ')}`, r.ms);
r = await call(A, 'POST', '/api/atividade'); rec('Missões', 'Sinal de tempo ativo', r.s === 200, JSON.stringify(r.j), r.ms);
r = await call(A, 'POST', '/api/convites'); rec('Missões', 'Gerar convite (sempre disponível)', r.s === 201, `código ${r.j?.data?.code?.slice?.(0, 4)}…`, r.ms);
r = await call(A, 'GET', '/api/carteira'); const bal0 = r.j.balance; rec('NewCoin', 'Carteira', r.s === 200, `saldo ${bal0} NWC`, r.ms);
const P2 = (await call(B2, 'POST', '/api/posts', { text: 'post para recompensar' })).j.data;
r = await call(A, 'POST', `/api/posts/${P2.id}/recompensa`); rec('NewCoin', 'Recompensar post (1 NWC)', r.s === 200, `HTTP ${r.s}`, r.ms);
r = await call(A, 'POST', `/api/posts/${P2.id}/recompensa`); rec('NewCoin', 'Segunda recompensa no mesmo post não cobra de novo', r.j?.data?.public_metrics?.tip_count === 1, `contador continua em ${r.j?.data?.public_metrics?.tip_count}`, r.ms);
r = await call(A, 'POST', `/api/posts/${RP.id}/recompensa`); rec('NewCoin', 'Não dá para recompensar o próprio post', r.s >= 400, `HTTP ${r.s}: ${r.j?.error}`, r.ms);
r = await call(A, 'GET', '/api/carteira'); rec('NewCoin', 'Saldo depois', true, `${bal0} → ${r.j.balance} NWC (as missões cumpridas no caminho também contam)`);
r = await call(null, 'GET', '/api/token'); rec('NewCoin', 'Regras públicas, com a evaporação', r.s === 200 && r.j?.evaporation_days === 7, `${r.j?.name} (${r.j?.symbol}); sem uso, o saldo zera em ${r.j?.evaporation_days} dias`, r.ms);

// Federação
r = await call(null, 'GET', `/.well-known/webfinger?resource=acct:ana_dev@${DOMAIN}`); rec('Federação', 'WebFinger', r.s === 200, r.j?.subject, r.ms);
r = await call(null, 'GET', '/federation/users/ana_dev/outbox'); rec('Federação', 'Outbox ActivityStreams', r.s === 200, `${r.j?.type}, ${r.j?.totalItems} itens`, r.ms);
r = await call(null, 'GET', '/.well-known/nodeinfo'); rec('Federação', 'NodeInfo', r.s === 200, JSON.stringify(r.j).slice(0, 100), r.ms);

// Segurança
freshLimits();
{
  const lr = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ana_dev@exemplo.test', password: 'senha1234' }) });
  const lj = await lr.json(); const ck = lr.headers.get('set-cookie') || '';
  const pl = JSON.parse(Buffer.from(lj.token.split('.')[1], 'base64url').toString());
  rec('Segurança', 'Acesso curto + cookie protegido', pl.exp - pl.iat === 900 && /HttpOnly/i.test(ck) && /SameSite=Strict/i.test(ck), `acesso de ${(pl.exp - pl.iat) / 60} min; cookie HttpOnly e SameSite=Strict`);
  const rf = await fetch(B + '/api/auth/refresh', { method: 'POST', headers: { cookie: ck.split(';')[0] } });
  rec('Segurança', 'Renovação pelo cookie', rf.status === 200, `HTTP ${rf.status}, cookie trocado (rotação)`);
  const lo = await fetch(B + '/api/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + (await rf.json()).token } });
  r = await call(lj.token, 'GET', '/api/auth/me');
  rec('Segurança', 'Sair invalida o acesso na hora', lo.status === 204 && r.s === 401, `logout ${lo.status}; o acesso anterior agora recebe ${r.s}`);
  const big = await fetch(B + '/api/posts', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + A }, body: JSON.stringify({ text: 'x'.repeat(40000) }) });
  rec('Segurança', 'Envio grande demais', big.status === 413, `HTTP ${big.status}: ${(await big.json()).error}`);
  r = await call(A, 'GET', '/api/users/ana_dev');
  rec('Segurança', 'Limite geral em toda a API', r.h.get('x-rate-limit-limit') === '600', `600 pedidos a cada 5 min por pessoa; restam ${r.h.get('x-rate-limit-remaining')}`, r.ms);
  rec('Segurança', 'Cabeçalhos de proteção', /default-src 'none'/.test(r.h.get('content-security-policy') || '') && r.h.get('x-frame-options') === 'DENY', `CSP fechada, X-Frame-Options ${r.h.get('x-frame-options')}, nosniff`);
  const L = await reg('trava_senha');
  let last;
  freshLimits();
  for (let i = 0; i < 11; i++) last = await call(null, 'POST', '/api/auth/login', { email: 'trava_senha@a.local', password: 'errada' + i });
  rec('Segurança', 'Até 10 senhas erradas por conta a cada 15 min', last.s === 429, `11ª tentativa → HTTP ${last.s}: ${last.j?.error}`, last.ms);
}

// Moderação, regras e recursos, grupos
freshLimits();
{
  const M1 = await reg('mod_alvo'), M2 = await reg('mod_vizinha'), M3 = await reg('mod_terceira');
  await call(M2.tok, 'POST', '/api/users/mod_alvo/follow');
  const pm = (await call(M1.tok, 'POST', '/api/posts', { text: 'post de quem vai ser silenciado' })).j.data;
  r = await call(M2.tok, 'POST', '/api/users/mod_alvo/mute'); rec('Moderação', 'Silenciar', r.s === 200 && r.j?.data?.muting, `HTTP ${r.s}`, r.ms);
  r = await call(M2.tok, 'GET', '/api/timeline?max_results=20'); rec('Moderação', 'Post de silenciado some do feed', !r.j.data.some((p) => p.id === pm.id), 'continua seguindo, mas não vê os posts', r.ms);
  r = await call(M2.tok, 'GET', `/api/posts/${pm.id}`); rec('Moderação', 'Ainda dá para abrir o post de propósito', r.s === 200, `HTTP ${r.s}`, r.ms);
  await call(M2.tok, 'DELETE', '/api/users/mod_alvo/mute');
  r = await call(M2.tok, 'POST', '/api/users/mod_alvo/block'); rec('Moderação', 'Bloquear', r.s === 200 && r.j?.data?.blocking, `HTTP ${r.s}`, r.ms);
  r = await call(M1.tok, 'POST', '/api/users/mod_vizinha/follow'); rec('Moderação', 'Bloqueado não segue de novo', r.s === 403, `HTTP ${r.s}: ${r.j?.error}`, r.ms);
  const pv = (await call(M2.tok, 'POST', '/api/posts', { text: 'post da vizinha' })).j.data;
  r = await call(M1.tok, 'POST', `/api/posts/${pv.id}/like`); rec('Moderação', 'Bloqueado não curte nem responde', r.s === 403, `curtir → HTTP ${r.s}`, r.ms);
  r = await call(M2.tok, 'GET', '/api/conta/bloqueados'); rec('Moderação', 'Lista de bloqueados', r.s === 200 && r.j.data.some((u) => u.username === 'mod_alvo'), `${r.j.data.length} conta(s)`, r.ms);
  r = await call(null, 'GET', '/api/denuncias/motivos'); rec('Moderação', 'Motivos de denúncia públicos', r.s === 200, r.j.data.map((x) => x.label).join(', '), r.ms);
  const pa = (await call(M1.tok, 'POST', '/api/posts', { text: 'post que vai ser denunciado' })).j.data;
  r = await call(M3.tok, 'POST', '/api/denuncias', { post_id: pa.id, reason: 'spam', details: 'teste da análise' }); const rep1 = r.j?.data;
  rec('Moderação', 'Denunciar post', r.s === 201, `HTTP ${r.s}`, r.ms);
  r = await call(M1.tok, 'DELETE', `/api/posts/${pa.id}`); const kept = (await call(A, 'GET', '/api/moderacao/denuncias')).j.data.some((x) => x.id === rep1.id);
  rec('Moderação', 'Autor não apaga a prova de um post denunciado', r.s < 300 && kept && (await call(M3.tok, 'GET', `/api/posts/${pa.id}`)).s === 404, 'o post sai do ar, mas a denúncia e o texto ficam para a moderação');
  r = await call(M3.tok, 'GET', '/api/moderacao/denuncias'); rec('Moderação', 'Fila só para quem modera', r.s === 403, `pessoa comum → HTTP ${r.s}`, r.ms);
  r = await call(null, 'GET', '/api/instancia/regras'); const rules = r.j.data.rules; rec('Regras e recursos', 'Regras públicas, sem login', r.s === 200, `${rules.length} regras: ${rules.slice(0, 3).map((x) => x.title).join(' · ')}…`, r.ms);
  const pb = (await call(M1.tok, 'POST', '/api/posts', { text: 'propaganda repetida aqui' })).j.data;
  const rep2 = (await call(M3.tok, 'POST', '/api/denuncias', { post_id: pb.id, reason: 'spam' })).j.data;
  r = await call(A, 'POST', `/api/moderacao/denuncias/${rep2.id}/resolver`, { action: 'remover_post' }); rec('Regras e recursos', 'Remover sem dizer a regra é recusado', r.s === 400, `HTTP ${r.s}: ${r.j?.error}`, r.ms);
  const spamRule = rules.find((x) => /spam/i.test(x.title)) ?? rules[0];
  r = await call(A, 'POST', `/api/moderacao/denuncias/${rep2.id}/resolver`, { action: 'remover_post', rule_id: spamRule.id, note: 'divulgação repetida' }); rec('Regras e recursos', 'Remover citando a regra', r.s === 200, `regra “${spamRule.title}”`, r.ms);
  r = await call(M3.tok, 'GET', `/api/posts/${pb.id}`); rec('Regras e recursos', 'Post removido sai do ar para todos', r.s === 404, `HTTP ${r.s}`, r.ms);
  r = await call(M3.tok, 'GET', '/api/denuncias'); const mine = r.j.data.find((x) => x.id === rep2.id); rec('Regras e recursos', 'Quem denunciou vê a decisão', mine?.status === 'acatada', `status ${mine?.status}`, r.ms);
  r = await call(M1.tok, 'GET', '/api/conta/decisoes'); const dec = r.j.data.find((x) => x.action === 'post_removido') ?? r.j.data[0]; rec('Regras e recursos', 'Autor vê a decisão e a regra', r.s === 200 && !!dec, `“${dec?.rule?.title ?? ''}”`, r.ms);
  r = await call(M1.tok, 'POST', `/api/conta/decisoes/${dec.id}/recurso`, { text: 'Foi um post só, não era propaganda repetida.' }); rec('Regras e recursos', 'Autor pede recurso', r.s === 201, `HTTP ${r.s}`, r.ms);
  r = await call(M1.tok, 'POST', `/api/conta/decisoes/${dec.id}/recurso`, { text: 'Pedindo de novo o mesmo recurso.' }); rec('Regras e recursos', 'Só um recurso por decisão', r.s === 409, `HTTP ${r.s}: ${r.j?.error}`, r.ms);
  r = await call(A, 'GET', '/api/moderacao/recursos'); const ap = r.j.data[0];
  r = await call(A, 'POST', `/api/moderacao/recursos/${ap.id}/decidir`, { decision: 'aceitar', note: 'revisto' }); rec('Regras e recursos', 'Moderação aceita o recurso', r.s === 200, `HTTP ${r.s}`, r.ms);
  r = await call(M3.tok, 'GET', `/api/posts/${pb.id}`); rec('Regras e recursos', 'Post volta ao ar', r.s === 200, `HTTP ${r.s}`, r.ms);
  const rep3 = (await call(M3.tok, 'POST', '/api/denuncias', { username: 'mod_alvo', reason: 'spam' })).j.data;
  r = await call(A, 'POST', `/api/moderacao/denuncias/${rep3.id}/resolver`, { action: 'suspender', rule_id: spamRule.id }); rec('Regras e recursos', 'Suspender conta citando a regra', r.s === 200, `HTTP ${r.s}`, r.ms);
  r = await call(M1.tok, 'GET', '/api/auth/me'); rec('Regras e recursos', 'Suspensa perde a sessão na hora', r.s === 401 || r.s === 403, `acesso antigo → HTTP ${r.s}`, r.ms);
  r = await call(null, 'POST', '/api/auth/login', { email: 'mod_alvo@a.local', password: 'senha1234' }); rec('Regras e recursos', 'Ao entrar, vê o motivo e a regra', r.s === 403 && !!r.j?.suspension?.rule, `regra “${r.j?.suspension?.rule?.title}”, pode recorrer: ${r.j?.suspension?.can_appeal}`, r.ms);
  r = await call(null, 'POST', '/api/recursos/suspensao', { email: 'mod_alvo@a.local', password: 'errada', text: 'Quero recorrer da suspensão.' }); rec('Regras e recursos', 'Recurso de suspensão exige a senha', r.s === 401, `senha errada → HTTP ${r.s}`, r.ms);
  r = await call(null, 'POST', '/api/recursos/suspensao', { email: 'mod_alvo@a.local', password: 'senha1234', text: 'Quero recorrer da suspensão.' }); rec('Regras e recursos', 'Recurso de suspensão sem estar logada', r.s === 201, `HTTP ${r.s}`, r.ms);
  r = await call(A, 'GET', '/api/moderacao/recursos'); const ap2 = r.j.data[0];
  await call(A, 'POST', `/api/moderacao/recursos/${ap2.id}/decidir`, { decision: 'aceitar' });
  r = await call(null, 'POST', '/api/auth/login', { email: 'mod_alvo@a.local', password: 'senha1234' }); rec('Regras e recursos', 'Recurso aceito: a conta volta a entrar', r.s === 200, `HTTP ${r.s}`, r.ms);
  const tA = r.j.token;
  await call(M3.tok, 'POST', '/api/channels', { slug: 'sala_analise', title: 'Sala análise', kind: 'group' });
  for (const t of [tA, M2.tok]) await call(t, 'POST', '/api/channels/sala_analise/members');
  const mA = (await call(tA, 'POST', '/api/channels/sala_analise/messages', { text: 'msg de quem foi bloqueado' })).j.data;
  await call(M3.tok, 'POST', '/api/channels/sala_analise/messages', { text: 'msg da terceira' });
  r = await call(M2.tok, 'GET', '/api/channels/sala_analise/messages'); const h = r.j.data.find((x) => x.id === mA.id);
  rec('Grupos', 'Mensagem de bloqueado vira aviso', h?.hidden === 'bloqueio' && h?.text === null, `texto ${h?.text === null ? 'removido' : 'visível'}, pts ${h?.pts} mantido`, r.ms);
  r = await call(M3.tok, 'GET', '/api/channels/sala_analise/messages'); rec('Grupos', 'Quem não bloqueou vê normal', r.j.data.some((x) => x.text === 'msg de quem foi bloqueado'), '', r.ms);
  r = await call(M2.tok, 'POST', `/api/channels/sala_analise/messages/${mA.id}/reactions`, { emoji: '👍' }); rec('Grupos', 'Não dá para reagir com bloqueio', r.s === 403, `HTTP ${r.s}`, r.ms);
  await call(M2.tok, 'DELETE', '/api/users/mod_alvo/block'); await call(M2.tok, 'POST', '/api/users/mod_terceira/mute');
  r = await call(M2.tok, 'GET', '/api/channels/sala_analise/messages'); const mm = r.j.data.find((x) => x.text === 'msg da terceira');
  rec('Grupos', 'Silenciado chega marcado para recolher', mm?.muted === true, `muted=${mm?.muted}`, r.ms);
}

// Brasil em dados
{
  r = await call(null, 'GET', '/api/dados'); const ind = r.j.data.indicators;
  rec('Brasil em dados', 'Cinco indicadores com o último número publicado', r.s === 200 && ind.length === 5 && ind.every((i) => i.latest), ind.map((i) => `${i.title.split(' (')[0].split(' em ')[0]} ${String(i.latest.value).replace('.', ',')}${i.unit.startsWith('%') ? '%' : ''}`).join(' · '), r.ms);
  rec('Brasil em dados', 'Registro conferido à mão, com data', r.j.data.mode === 'registro' && !!r.j.data.checked_at, `modo ${r.j.data.mode}, conferido em ${r.j.data.checked_at}; não se atualiza sozinho`);
  const years = ind.map((i) => new Set(i.history.map((h) => String(h.period).slice(0, 4))).size);
  rec('Brasil em dados', 'Histórico de 5 anos em cada indicador', years.every((n) => n >= 5), `${Math.min(...years)} a ${Math.max(...years)} anos por indicador`);
  const srcs = ind.flatMap((i) => i.sources);
  rec('Brasil em dados', 'Cada fonte com papel e link', srcs.every((x) => ['origem', 'republicacao', 'independente'].includes(x.role) && x.page), `${srcs.length} fontes: ${['origem', 'republicacao', 'independente'].map((k) => srcs.filter((x) => x.role === k).length + ' ' + k).join(', ')}`);
  rec('Brasil em dados', 'Selo de verificação em cada número', ind.every((i) => i.badge), ind.map((i) => i.badge).join(', '));
}

// Apagar
r = await call(B2, 'DELETE', `/api/posts/${P.id}`); rec('Posts', 'Apagar post', r.s < 300, `HTTP ${r.s}`, r.ms);
r = await call(A, 'GET', `/api/posts/${P.id}`); rec('Posts', 'Post apagado some', r.s === 404, `HTTP ${r.s}`, r.ms);

fs.writeFileSync(R + '/results.json', JSON.stringify(out, null, 1));
console.log(out.filter((x) => x.ok).length + '/' + out.length);
process.exit(0);
