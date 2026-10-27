import { describe, expect, it } from 'vitest';
import { buildThread } from './thread.js';

const p = (id, parent = null) => ({ id, in_reply_to_post_id: parent });

describe('buildThread', () => {
  const posts = [p('1'), p('2', '1'), p('3', '2'), p('4', '2'), p('5', '4'), p('6', '1')];

  it('separa ancestrais, foco e árvore de respostas', () => {
    const t = buildThread(posts, '2');
    expect(t.ancestors.map((x) => x.id)).toEqual(['1']);
    expect(t.focal.id).toBe('2');
    expect(t.replies.map((n) => n.post.id)).toEqual(['3', '4']);
    expect(t.replies[1].children.map((n) => n.post.id)).toEqual(['5']);
  });

  it('foco na raiz não tem ancestrais', () => {
    const t = buildThread(posts, '1');
    expect(t.ancestors).toEqual([]);
    expect(t.replies.map((n) => n.post.id)).toEqual(['2', '6']);
  });

  it('foco inexistente devolve vazio', () => {
    expect(buildThread(posts, '99').focal).toBeNull();
  });
});
