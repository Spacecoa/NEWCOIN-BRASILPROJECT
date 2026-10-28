import { io } from 'socket.io-client';
import { refreshSession, tokenStore } from './api.js';

// Uma conexão WebSocket por sessão. O servidor só faz push; escritas vão por REST.
// O token é lido a cada (re)conexão, então a renovação a cada 15 min não derruba a conexão.
let socket = null;
let socketUser = null;

export function getSocket(userId) {
  if (!userId) return null;
  if (socket && socketUser === userId) return socket;
  socket?.disconnect();
  socketUser = userId;
  socket = io({ auth: (cb) => cb({ token: tokenStore.get() }), transports: ['websocket'] });
  const current = socket;
  // Reconexão recusada (token venceu enquanto a aba dormia): renova e tenta de novo.
  // Se o servidor encerrou a sessão (a pessoa saiu em outro lugar), não insiste.
  current.on('connect_error', async (err) => {
    if (err?.message !== 'unauthorized' || current !== socket) return;
    if (await refreshSession()) current.connect();
  });
  return current;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
  socketUser = null;
}
