import { useCallback, useState } from 'react';

// Armazena posts e usuários normalizados por ID. Assim, curtir um post atualiza todas
// as suas aparições na tela (no feed, como original de um repost, numa thread...).
// É o mesmo motivo pelo qual a X API devolve `includes` separado de `data`.
export function usePostStore() {
  const [posts, setPosts] = useState({});
  const [users, setUsers] = useState({});

  const merge = useCallback(({ data, includes } = {}) => {
    const list = [...(Array.isArray(data) ? data : data ? [data] : []), ...(includes?.posts ?? [])];
    if (list.length) setPosts((prev) => ({ ...prev, ...Object.fromEntries(list.map((p) => [p.id, p])) }));
    if (includes?.users?.length) setUsers((prev) => ({ ...prev, ...Object.fromEntries(includes.users.map((u) => [u.id, u])) }));
  }, []);

  const remove = useCallback((id) => {
    setPosts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  return { posts, users, merge, remove };
}
