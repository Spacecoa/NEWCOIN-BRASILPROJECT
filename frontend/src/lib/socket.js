import { io } from 'socket.io-client';

// Uma conexão WebSocket por sessão. O servidor só faz push; escritas vão por REST.
let socket = null;
let socketToken = null;

export function getSocket(token) {
  if (!token) return null;
  if (socket && socketToken === token) return socket;
  socket?.disconnect();
  socketToken = token;
  socket = io({ auth: { token }, transports: ['websocket'] });
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
  socketToken = null;
}
