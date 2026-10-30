import { config } from '../config.js';
import { getRedis } from '../cache.js';
import { bus } from '../realtime/bus.js';
import { getPost } from './posts.js';
import { filterAudience } from './relations.js';
import { followerIds, pushToTimelines } from './timeline.js';

// Distribuição dos posts para as timelines dos seguidores (docs/10, M1).
//
// Antes, a cópia para cada seguidor acontecia dentro do pedido de postar: uma conta com 4 mil
// seguidores esperava 230 a 340 ms, e com 100 mil seria segundos travando o processo. Agora:
// - no pedido, o post vai só para a timeline da autora, e um trabalho entra na fila (Redis);
// - um trabalhador, em segundo plano, copia para os seguidores em blocos e só então avisa em
//   tempo real (timeline:new);
// - sem Redis (ou com FANOUT_QUEUE=0), tudo roda na hora, como antes.
// A fila é confiável: o trabalho vai para uma lista "em andamento" do processo e só sai dela
// quando termina. Se o processo cair no meio, ele devolve esses trabalhos à fila ao reiniciar.
//
// Cada instância (WORKER_ID) tem a sua fila. O aviso em tempo real sai do barramento do
// processo, então o trabalho precisa rodar na mesma instância que recebeu o post (com uma fila
// só, outra instância pegava o trabalho e o aviso saía no processo errado).

export const queueKey = () => `fanout:queue:${config.workerId}`;
const processing = () => `fanout:processing:${config.workerId}`;
const useQueue = () => config.fanoutQueue && getRedis();

/** Chamado ao criar post ou repost. */
export async function distribute(postId, authorId) {
  if (!useQueue()) return runJob({ postId, authorId });
  await pushToTimelines([authorId], postId);
  try {
    await getRedis().lpush(queueKey(), JSON.stringify({ postId, authorId, at: Date.now() }));
  } catch {
    // Redis caiu entre um passo e outro: faz agora mesmo, para ninguém ficar sem o post.
    return runJob({ postId, authorId });
  }
}

/** Copia para os seguidores e avisa em tempo real quem pode ver o post. */
export async function runJob({ postId, authorId }) {
  const followers = await followerIds(authorId);
  await pushToTimelines(followers, postId);
  const post = await getPost(postId, authorId).catch(() => null); // apagado nesse meio-tempo
  if (!post) return;
  const audience = await filterAudience(authorId, [authorId, ...followers]);
  bus.emit('post:created', { post, audience });
}

/** Tamanho da fila (para as métricas). */
export async function queueLength() {
  if (!useQueue()) return 0;
  return getRedis().llen(queueKey()).catch(() => -1);
}

/** Processa tudo o que está na fila e para (usado nos testes e ao desligar). */
export async function drainFanoutQueue() {
  const redis = getRedis();
  for (;;) {
    const raw = await redis.lmove(queueKey(), processing(), 'RIGHT', 'LEFT');
    if (!raw) return;
    await runJob(JSON.parse(raw)).catch((err) => console.warn('[fila] trabalho falhou:', err.message));
    await redis.lrem(processing(), 1, raw);
  }
}

/**
 * Trabalhador: uma conexão própria ao Redis (BLMOVE bloqueia a conexão enquanto espera).
 * Devolve uma função para parar.
 */
export async function startFanoutWorker() {
  if (!useQueue()) return () => {};
  const redis = getRedis().duplicate();
  // Trabalhos que estavam em andamento quando o processo caiu voltam para a fila.
  while (await redis.lmove(processing(), queueKey(), 'RIGHT', 'LEFT'));
  let running = true;
  (async () => {
    while (running) {
      try {
        const raw = await redis.blmove(queueKey(), processing(), 'RIGHT', 'LEFT', 5);
        if (!raw) continue;
        await runJob(JSON.parse(raw)).catch((err) => console.warn('[fila] trabalho falhou:', err.message));
        await redis.lrem(processing(), 1, raw);
      } catch (err) {
        if (!running) break;
        console.warn('[fila] Redis indisponível, tentando de novo:', err.message);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  })();
  return () => {
    running = false;
    redis.disconnect();
  };
}
