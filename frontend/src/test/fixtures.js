import { vi } from 'vitest';

export const users = {
  ana: { id: '1', username: 'ana_dev', display_name: 'Ana Souza' },
  bruno: { id: '2', username: 'bruno', display_name: 'Bruno Lima' },
};

let seq = 100;
export function makePost(overrides = {}) {
  seq += 1;
  return {
    id: String(seq),
    text: `post ${seq}`,
    author_id: '1',
    created_at: new Date().toISOString(),
    conversation_id: String(seq),
    in_reply_to_post_id: null,
    referenced_posts: [],
    public_metrics: { like_count: 0, reply_count: 0, repost_count: 0 },
    viewer: { liked: false, reposted: false },
    ...overrides,
  };
}

/** Substitui fetch por um roteador simples: [[regex, resposta | (url, init) => resposta], ...] */
export function mockFetch(routes) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      calls.push({ url, init });
      for (const [pattern, response] of routes) {
        if (pattern.test(url)) {
          const body = typeof response === 'function' ? response(url, init) : response;
          return { ok: true, status: 200, json: async () => body };
        }
      }
      return { ok: false, status: 404, json: async () => ({ error: 'não mockado' }) };
    }),
  );
  return calls;
}
