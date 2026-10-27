import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeviceSource, importFromServer, learnedView, learnLocal, loadState, rankLocally, resetLearning, saveSettings } from './deviceAlgo.js';

const ME = '1';
const hour = 3_600_000;
const mk = (id, author_id, text, hoursAgo = 1, likes = 0) => ({
  id,
  author_id,
  text,
  created_at: new Date(Date.now() - hoursAgo * hour).toISOString(),
  public_metrics: { like_count: likes, repost_count: 0, reply_count: 0, tip_count: 0 },
  viewer: { liked: false, reposted: false, tipped: false },
  referenced_posts: [],
});
const candidates = (posts, following = []) => ({ data: posts, includes: { users: [], posts: [] }, meta: { following } });

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('algoritmo neste aparelho', () => {
  it('guarda as preferências só no navegador, sem as chaves que pertencem ao servidor', () => {
    saveSettings(ME, { topics: { frontend: 1 }, keywords: ['react'], missions_enabled: false, ranking_mode: 'device' });
    const raw = JSON.parse(localStorage.getItem('agora.algo.v1.1'));
    expect(raw.settings.topics).toEqual({ frontend: 1 });
    expect(raw.settings.keywords).toEqual(['react']);
    expect(raw.settings.missions_enabled).toBe(true); // padrão: a chave do servidor não foi gravada
    expect(loadState(ME).settings.weights.popularidade).toBe(0);
  });

  it('preferência declarada muda a ordem (mesma conta do servidor)', () => {
    const c = candidates([mk('10', '2', 'Deploy no Kubernetes', 1), mk('11', '3', 'Componente React acessível', 2)]);
    expect(rankLocally(ME, c).ranked.map((r) => r.post.id)).toEqual(['10', '11']);
    saveSettings(ME, { topics: { frontend: 1 } });
    const { ranked, personalized } = rankLocally(ME, c);
    expect(ranked.map((r) => r.post.id)).toEqual(['11', '10']);
    expect(personalized).toBe(true);
    expect(ranked[0].reasons[0]).toMatchObject({ fator: 'interesse', valor: 1 });
  });

  it('aprende com sinais explícitos, ignora os próprios posts e "menos disto" esconde', () => {
    const p = mk('20', '2', 'Cache Redis na prática');
    learnLocal(ME, p, 'like', 'bruno');
    expect(learnedView(ME)).toEqual({ topics: [{ topic: 'bancos', label: 'Bancos de dados', value: 0.15 }], authors: [{ author_id: '2', username: 'bruno', value: 0.15 }] });
    learnLocal(ME, mk('21', ME, 'meu post sobre React'), 'like');
    expect(learnedView(ME).topics.map((t) => t.topic)).toEqual(['bancos']);
    learnLocal(ME, p, 'less', 'bruno');
    expect(rankLocally(ME, candidates([p, mk('22', '3', 'outro')])).ranked.map((r) => r.post.id)).toEqual(['22']);
    resetLearning(ME);
    expect(learnedView(ME)).toEqual({ topics: [], authors: [] });
    expect(loadState(ME).hidden).toEqual([]);
  });

  it('importa do servidor antes de trocar de modo', () => {
    importFromServer(ME, {
      settings: { topics: { bancos: 0.7 }, keywords: ['webfinger'], ranking_mode: 'server', missions_enabled: false },
      learned: { topics: [{ topic: 'redes', value: 0.3 }], authors: [{ author_id: '9', username: 'heitor', value: 0.2 }] },
      hidden_post_ids: ['77'],
    });
    const s = loadState(ME);
    expect(s.settings.topics).toEqual({ bancos: 0.7 });
    expect(s.settings.keywords).toEqual(['webfinger']);
    expect(s.hidden).toEqual(['77']);
    expect(learnedView(ME).authors).toEqual([{ author_id: '9', username: 'heitor', value: 0.2 }]);
  });

  it('apagar os dados do site zera o algoritmo deste aparelho', () => {
    saveSettings(ME, { keywords: ['x'] });
    localStorage.clear();
    expect(loadState(ME).settings.keywords).toEqual([]);
    localStorage.setItem('agora.algo.v1.1', '{corrompido');
    expect(loadState(ME).settings.keywords).toEqual([]);
  });

  it('funciona sem armazenamento do navegador (modo privado), guardando em memória', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    saveSettings('7', { keywords: ['ciclovia'] });
    expect(loadState('7').settings.keywords).toEqual(['ciclovia']);
  });

  it('fonte do Feed: baixa candidatos uma vez, pagina localmente e sinaliza o fim', async () => {
    const posts = Array.from({ length: 5 }, (_, i) => mk(String(100 + i), String(2 + (i % 3)), `post ${i}`, i + 1));
    const fetcher = vi.fn(async () => candidates(posts, ['2']));
    saveSettings(ME, { session_limit: 5 });
    const source = createDeviceSource(ME, fetcher);
    const p1 = await source(null, 3);
    expect(p1.data).toHaveLength(3);
    expect(p1.data[0].ranking).toMatchObject({ position: 1, local: true });
    expect(p1.meta).toMatchObject({ next_token: '3', caught_up: false, mode: 'device' });
    const p2 = await source(p1.meta.next_token, 3);
    expect(p2.data.map((p) => p.ranking.position)).toEqual([4, 5]);
    expect(p2.meta).toMatchObject({ caught_up: true, session: { delivered: 5, available: 5 } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const ids = [...p1.data, ...p2.data].map((p) => p.id);
    expect(new Set(ids).size).toBe(5);
  });
});
