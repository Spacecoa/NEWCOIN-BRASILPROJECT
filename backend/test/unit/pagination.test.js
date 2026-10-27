import { describe, expect, it } from 'vitest';
import { applyCursor, pageMeta, parsePageParams } from '../../src/lib/pagination.js';

describe('paginação', () => {
  it('usa valores padrão e aceita max_id como alias de until_id', () => {
    expect(parsePageParams({})).toEqual({ sinceId: null, untilId: null, limit: 20 });
    expect(parsePageParams({ max_id: '10', max_results: '5' })).toEqual({ sinceId: null, untilId: '10', limit: 5 });
  });

  it('rejeita max_results fora de 1..100 e IDs não numéricos', () => {
    expect(() => parsePageParams({ max_results: '500' })).toThrow();
    expect(() => parsePageParams({ since_id: 'abc' })).toThrow();
  });

  it('applyCursor compara IDs como BigInt (exclusivo nas duas pontas)', () => {
    const ids = ['9007199254740999', '9007199254740995', '30', '20', '10'];
    expect(applyCursor(ids, { sinceId: '10', untilId: '9007199254740999' })).toEqual(['9007199254740995', '30', '20']);
  });

  it('pageMeta só oferece next_token quando a página está cheia', () => {
    const items = [{ id: '3' }, { id: '2' }];
    expect(pageMeta(items, 2)).toEqual({ result_count: 2, newest_id: '3', oldest_id: '2', next_token: '2' });
    expect(pageMeta(items, 5).next_token).toBeUndefined();
    expect(pageMeta([], 5)).toEqual({ result_count: 0 });
  });
});
