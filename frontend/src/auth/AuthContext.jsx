import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, refreshSession, tokenStore } from '../lib/api.js';
import { resetDeviceAlgorithmSync } from '../lib/rankingMode.js';
import { closeSocket, getSocket } from '../lib/socket.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(tokenStore.get);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Aviso mostrado na faixa de visitante e na tela de entrar (ex.: "Você saiu da sua conta.").
  const [notice, setNotice] = useState(null);
  const userRef = useRef(null);
  userRef.current = user;

  // Acompanha renovações automáticas; se a sessão acabar (token null), sai da conta.
  useEffect(
    () =>
      tokenStore.subscribe((t) => {
        setToken(t);
        if (!t) {
          closeSocket();
          // Só avisa se havia alguém logado (a sessão foi encerrada em outro lugar ou venceu).
          if (userRef.current) setNotice('Sua sessão terminou. Entre de novo para continuar.');
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
    setNotice(null);
    setLoading(false);
  }, []);

  const endLocal = useCallback((message) => {
    closeSocket();
    resetDeviceAlgorithmSync();
    setUser(null);
    tokenStore.set(null);
    setNotice(message);
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      notice,
      clearNotice: () => setNotice(null),
      socket: user ? getSocket(user.id) : null,
      login: async (email, password) => finish(await api('/api/auth/login', { method: 'POST', body: { email, password } })),
      register: async (input) => finish(await api('/api/auth/register', { method: 'POST', body: input })),
      // Sair encerra a sessão no servidor: o token deixa de valer na hora.
      logout: async () => {
        await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
        endLocal('Você saiu da sua conta.');
      },
      // Para quando um aparelho foi perdido: encerra a sessão em todos.
      logoutEverywhere: async () => {
        await api('/api/auth/logout-all', { method: 'POST' }).catch(() => {});
        endLocal('Você saiu da sua conta em todos os aparelhos.');
      },
    }),
    [user, token, loading, notice, finish, endLocal],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return ctx;
}
