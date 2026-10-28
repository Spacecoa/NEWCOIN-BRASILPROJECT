import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, refreshSession, tokenStore } from '../lib/api.js';
import { resetCachedMode } from '../lib/rankingMode.js';
import { closeSocket, getSocket } from '../lib/socket.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(tokenStore.get);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Acompanha renovações automáticas; se a sessão acabar (token null), sai da conta.
  useEffect(
    () =>
      tokenStore.subscribe((t) => {
        setToken(t);
        if (!t) {
          closeSocket();
          setUser(null);
        }
      }),
    [],
  );

  // Ao abrir o app: o cookie de sessão (se houver) vira um token de acesso.
  useEffect(() => {
    let cancelled = false;
    refreshSession()
      .then((data) => !cancelled && data && setUser(data.user))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const finish = useCallback(({ token, user }) => {
    tokenStore.set(token);
    setUser(user);
    setLoading(false);
  }, []);

  const endLocal = useCallback(() => {
    closeSocket();
    resetCachedMode();
    tokenStore.set(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      socket: user ? getSocket(user.id) : null,
      login: async (login, password) => finish(await api('/api/auth/login', { method: 'POST', body: { login, password } })),
      register: async (input) => finish(await api('/api/auth/register', { method: 'POST', body: input })),
      // Sair encerra a sessão no servidor: o token deixa de valer na hora.
      logout: async () => {
        await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
        endLocal();
      },
      // Para quando um aparelho foi perdido: encerra a sessão em todos.
      logoutEverywhere: async () => {
        await api('/api/auth/logout-all', { method: 'POST' }).catch(() => {});
        endLocal();
      },
    }),
    [user, token, loading, finish, endLocal],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return ctx;
}
