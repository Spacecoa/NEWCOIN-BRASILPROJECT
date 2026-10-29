import { beforeEach, describe, expect, it } from 'vitest';
import { mockFetch } from '../test/fixtures.js';
import { loadState, saveSettings } from './deviceAlgo.js';
import { resetDeviceAlgorithmSync, syncDeviceAlgorithm } from './rankingMode.js';

// O algoritmo fica só no aparelho e é carregado daqui sempre que a pessoa volta ao app.

const legacy = {
  settings: { ranking_mode: 'server', topics: { bancos: 1 }, keywords: ['redis'], missions_enabled: true },
  learned: { topics: [{ topic: 'bancos', value: 0.3 }], authors: [] },
  hidden_post_ids: ['77'],
};

beforeEach(() => {
  localStorage.clear();
  resetDeviceAlgorithmSync();
});

describe('carga do algoritmo deste aparelho', () => {
  it('conta antiga sem algoritmo neste aparelho: traz o do servidor e pede para apagar lá', async () => {
    const calls = mockFetch([
      [/\/api\/feed\/preferencias$/, legacy],
      [/\/api\/feed\/modo$/, { mode: 'device' }],
    ]);
    expect(await syncDeviceAlgorithm('u1')).toEqual({ source: 'imported' });
    expect(loadState('u1').settings).toMatchObject({ topics: { bancos: 1 }, keywords: ['redis'] });
    expect(loadState('u1').hidden).toEqual(['77']);
    expect(calls.find((c) => c.url === '/api/feed/modo').init).toMatchObject({ method: 'PUT', body: JSON.stringify({ mode: 'device' }) });
  });

  it('o algoritmo que já está neste aparelho vale: nada do servidor o sobrescreve', async () => {
    saveSettings('u2', { keywords: ['ciclovia'] });
    mockFetch([
      [/\/api\/feed\/preferencias$/, legacy],
      [/\/api\/feed\/modo$/, { mode: 'device' }],
    ]);
    expect(await syncDeviceAlgorithm('u2')).toEqual({ source: 'device' });
    expect(loadState('u2').settings.keywords).toEqual(['ciclovia']);
  });

  it('conta nova: carrega deste aparelho e não manda nada ao servidor', async () => {
    saveSettings('u3', { keywords: ['feira'] });
    const calls = mockFetch([[/\/api\/feed\/preferencias$/, { settings: { ranking_mode: 'device' }, learned: { topics: [], authors: [] }, hidden_post_ids: [] }]]);
    expect(await syncDeviceAlgorithm('u3')).toEqual({ source: 'device' });
    expect(calls.some((c) => c.url === '/api/feed/modo')).toBe(false);
    resetDeviceAlgorithmSync();
    localStorage.clear();
    expect(await syncDeviceAlgorithm('u4')).toEqual({ source: 'new' });
  });
});
