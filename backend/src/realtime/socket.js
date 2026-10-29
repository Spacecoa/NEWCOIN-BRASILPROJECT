import { Server } from 'socket.io';
import { config } from '../config.js';
import { authenticate } from '../lib/auth.js';
import { assertCanRead, getChannel, hiddenMessage } from '../services/channels.js';
import { authorRelations } from '../services/relations.js';
import { bus } from './bus.js';

// Salas:
//   user:<id>     — eventos pessoais (novo item na timeline, menções, replies)
//   channel:<id>  — mensagens e reações de um canal/grupo
// O cliente só escreve via REST; o WebSocket é usado apenas para "push" do servidor,
// o que mantém um único caminho de escrita (mais fácil de validar e testar).

// Limites por conexão (docs/14, C-4): uma conta não abre conexões sem fim, uma conexão não
// assina canais sem fim, e pedidos de assinatura têm ritmo máximo.
export const WS_LIMITS = { connectionsPerUser: 10, channelsPerSocket: 50, subscribesPerMinute: 30 };

export function attachRealtime(httpServer) {
  const io = new Server(httpServer, { cors: { origin: config.corsOrigin }, maxHttpBufferSize: 16 * 1024 });

  io.use(async (socket, next) => {
    const user = await authenticate(String(socket.handshake.auth?.token ?? ''));
    if (!user) return next(new Error('unauthorized'));
    const open = await io.in(`user:${user.id}`).fetchSockets();
    if (open.length >= WS_LIMITS.connectionsPerUser) return next(new Error('too_many_connections'));
    socket.data.user = user;
    socket.data.channels = new Set();
    socket.data.subscribes = { windowStart: Date.now(), count: 0 };
    next();
  });

  const subscribeAllowed = (socket) => {
    const w = socket.data.subscribes;
    if (Date.now() - w.windowStart > 60_000) Object.assign(w, { windowStart: Date.now(), count: 0 });
    w.count++;
    return w.count <= WS_LIMITS.subscribesPerMinute;
  };

  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.user.id}`);
    // Sala da sessão: quando a pessoa sai, a conexão deste aparelho cai junto.
    socket.join(`session:${socket.data.user.sid}`);

    socket.on('channel:subscribe', async ({ slug } = {}, ack) => {
      try {
        if (!subscribeAllowed(socket)) return ack?.({ ok: false, error: 'Muitos pedidos de assinatura. Tente em instantes.' });
        const channel = await getChannel(String(slug), socket.data.user.id);
        // Grupo: só quem é membro recebe as mensagens ao vivo (docs/14, C-1).
        assertCanRead(channel);
        if (!socket.data.channels.has(channel.id) && socket.data.channels.size >= WS_LIMITS.channelsPerSocket) {
          return ack?.({ ok: false, error: `Limite de ${WS_LIMITS.channelsPerSocket} canais por conexão` });
        }
        socket.data.channels.add(channel.id);
        await socket.join(`channel:${channel.id}`);
        ack?.({ ok: true, pts: channel.pts });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('channel:unsubscribe', async ({ slug } = {}) => {
      try {
        const channel = await getChannel(String(slug), socket.data.user.id);
        socket.data.channels.delete(channel.id);
        await socket.leave(`channel:${channel.id}`);
      } catch {
        /* ignora */
      }
    });
  });

  const handlers = {
    'post:created': ({ post, audience }) => {
      for (const uid of audience) io.to(`user:${uid}`).emit('timeline:new', post);
    },
    'session:revoked': ({ sid }) => io.in(`session:${sid}`).disconnectSockets(true),
    'post:deleted': ({ id }) => io.emit('post:deleted', { id }),
    notification: ({ userIds, type, post }) => {
      for (const uid of userIds) io.to(`user:${uid}`).emit('notification', { type, post });
    },
    // Cada pessoa no canal recebe a versão que pode ver: quem tem bloqueio com o autor
    // recebe o aviso "mensagem oculta" (no lugar certo do pts); quem silenciou, a mensagem marcada.
    'message:created': async ({ channelId, message }) => {
      const room = `channel:${channelId}`;
      const rel = await authorRelations(message.data.author_id).catch(() => ({ blocked: new Set(), muted: new Set() }));
      if (!rel.blocked.size && !rel.muted.size) return io.to(room).emit('message:new', message);
      const hidden = { data: hiddenMessage(message.data, 'bloqueio'), includes: { users: [] } };
      const muted = { ...message, data: { ...message.data, muted: true } };
      for (const s of await io.in(room).fetchSockets()) {
        const uid = s.data.user?.id;
        s.emit('message:new', rel.blocked.has(uid) ? hidden : rel.muted.has(uid) ? muted : message);
      }
    },
    // Removido de um grupo: as conexões dessa pessoa saem da sala na hora.
    'channel:removed': async ({ channelId, userId }) => {
      for (const s of await io.in(`user:${userId}`).fetchSockets()) {
        s.leave(`channel:${channelId}`);
        s.data.channels?.delete(channelId);
        s.emit('channel:removed', { channel_id: channelId });
      }
    },
    'message:reactions': ({ channelId, messageId, reactions }) =>
      io.to(`channel:${channelId}`).emit('message:reactions', { message_id: messageId, reactions }),
  };
  for (const [event, fn] of Object.entries(handlers)) bus.on(event, fn);

  io.on('close', () => {
    for (const [event, fn] of Object.entries(handlers)) bus.off(event, fn);
  });
  return io;
}
