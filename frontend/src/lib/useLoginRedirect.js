import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';

/**
 * Visitante (sem conta) pode ler tudo o que é público, mas não interagir. Ao tentar curtir,
 * repostar, responder, recompensar ou seguir, vai para a tela de entrar, guardando a página
 * de onde veio: depois do login, volta para ela.
 */
export function useLoginRedirect() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  return useCallback(() => navigate('/login', { state: { from: pathname + search } }), [navigate, pathname, search]);
}
