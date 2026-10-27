// Monta a visão de thread a partir da lista plana de posts da conversa
// (todos com o mesmo conversation_id), usando in_reply_to_post_id.
export function buildThread(posts, focalId) {
  const byId = new Map(posts.map((p) => [p.id, p]));
  const focal = byId.get(focalId) ?? null;
  if (!focal) return { ancestors: [], focal: null, replies: [] };

  const ancestors = [];
  for (let cur = byId.get(focal.in_reply_to_post_id); cur; cur = byId.get(cur.in_reply_to_post_id)) {
    ancestors.unshift(cur);
  }

  const children = new Map();
  for (const p of posts) {
    if (!p.in_reply_to_post_id) continue;
    if (!children.has(p.in_reply_to_post_id)) children.set(p.in_reply_to_post_id, []);
    children.get(p.in_reply_to_post_id).push(p);
  }
  const toNode = (post) => ({ post, children: (children.get(post.id) ?? []).map(toNode) });
  return { ancestors, focal, replies: (children.get(focal.id) ?? []).map(toNode) };
}
