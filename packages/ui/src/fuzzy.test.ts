import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from './fuzzy';

describe('fuzzy matching', () => {
  it('matches letters in order and rejects the rest', () => {
    expect(fuzzyScore('sas', 'Save as')).toBeGreaterThan(0);
    expect(fuzzyScore('xyz', 'Save as')).toBe(-1);
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('prefers word starts', () => {
    const titles = ['Trim pages', 'Rotate page', 'Print'];
    expect(fuzzyFilter(titles, 'rp', (t) => t)[0]).toBe('Rotate page');
  });

  it('keeps everything for an empty query', () => {
    expect(fuzzyFilter(['a', 'b'], '  ', (t) => t)).toEqual(['a', 'b']);
  });
});
