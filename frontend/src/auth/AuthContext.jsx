import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore } from '../lib/api.js';
import { closeSocket, getSocket } from '../lib/socket.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(tokenStore.get);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(token));

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api('/api/auth/me', { token })
      .then(({ user }) => !cancelled && setUser(user))
      .catch(() => {
        if (cancelled) return;
        tokenStore.set(null);
        setToken(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const finish = useCallback(({ token, user }) => {
    tokenStore.set(token);
    setToken(token);
    setUser(user);
    setLoading(false);
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      socket: user ? getSocket(token) : null,
      login: async (login, password) => finish(await api('/api/auth/login', { method: 'POST', body: { login, password } })),
      register: async (input) => finish(await api('/api/auth/register', { method: 'POST', body: input })),
      logout: () => {
        tokenStore.set(null);
        closeSocket();
        setToken(null);
        setUser(null);
      },
    }),
    [user, token, loading, finish],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return ctx;
}
