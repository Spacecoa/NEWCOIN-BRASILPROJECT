import { describe, expect, it } from 'vitest';
import { extractMentions } from '../../src/lib/text.js';

describe('extractMentions', () => {
  it('extrai menções únicas e em minúsculas', () => {
    expect(extractMentions('oi @Ana_Dev e @bruno, de novo @ana_dev!')).toEqual(['ana_dev', 'bruno']);
  });
  it('ignora e-mails e handles curtos demais', () => {
    expect(extractMentions('mail: x@exemplo.com e @ab')).toEqual([]);
  });
  it('aceita menção no início do texto', () => {
    expect(extractMentions('@carla_ux bom dia')).toEqual(['carla_ux']);
  });
});
