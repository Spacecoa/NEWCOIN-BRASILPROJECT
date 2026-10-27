import { Server } from 'socket.io';
import { config } from '../config.js';
import { verifyToken } from '../lib/auth.js';
import { getChannel } from '../services/channels.js';
import { bus } from './bus.js';

// Salas:
//   user:<id>     — eventos pessoais (novo item na timeline, menções, replies)
//   channel:<id>  — mensagens e reações de um canal/grupo
// O cliente só escreve via REST; o WebSocket é usado apenas para "push" do servidor,
// o que mantém um único caminho de escrita (mais fácil de validar e testar).

export function attachRealtime(httpServer) {
  const io = new Server(httpServer, { cors: { origin: config.corsOrigin } });

  io.use((socket, next) => {
    const user = verifyToken(socket.handshake.auth?.token ?? '');
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.user.id}`);

    socket.on('channel:subscribe', async ({ slug } = {}, ack) => {
      try {
        const channel = await getChannel(String(slug), socket.data.user.id);
        await socket.join(`channel:${channel.id}`);
        ack?.({ ok: true, pts: channel.pts });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('channel:unsubscribe', async ({ slug } = {}) => {
      try {
        const channel = await getChannel(String(slug), socket.data.user.id);
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
    'post:deleted': ({ id }) => io.emit('post:deleted', { id }),
    notification: ({ userIds, type, post }) => {
      for (const uid of userIds) io.to(`user:${uid}`).emit('notification', { type, post });
    },
    'message:created': ({ channelId, message }) => io.to(`channel:${channelId}`).emit('message:new', message),
    'message:reactions': ({ channelId, messageId, reactions }) =>
      io.to(`channel:${channelId}`).emit('message:reactions', { message_id: messageId, reactions }),
  };
  for (const [event, fn] of Object.entries(handlers)) bus.on(event, fn);

  io.on('close', () => {
    for (const [event, fn] of Object.entries(handlers)) bus.off(event, fn);
  });
  return io;
}
