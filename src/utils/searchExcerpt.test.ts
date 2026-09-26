import { describe, expect, test } from 'bun:test';
import { searchExcerpt } from './searchExcerpt';

const plain = (parts: ReturnType<typeof searchExcerpt>) => parts.map(part => part.text).join('');
const matches = (parts: ReturnType<typeof searchExcerpt>) => parts.filter(part => part.matched).map(part => part.text);

describe('search result excerpts', () => {
  test('centers and highlights a literal hyphenated term in later cell content', () => {
    const parts = searchExcerpt([
      { type: 'markdown', data: 'Background. '.repeat(30) },
      { type: 'code', data: 'const label = "fresh-index-r3";' },
    ], 'fresh-index-r3');
    expect(plain(parts)).toContain('fresh-index-r3');
    expect(matches(parts)).toEqual(['fresh-index-r3']);
  });
  test('shows a code match after a long earlier Markdown cell', () => {
    const parts = searchExcerpt([
      { type: 'markdown', data: 'A long introduction. '.repeat(30) },
      { type: 'code', data: 'const answer = 42;\nreturn answer;' },
    ], 'answer');
    expect(plain(parts)).toContain('const answer = 42;');
    expect(plain(parts)).toStartWith('…');
    expect(matches(parts)).toEqual(['answer', 'answer']);
    expect(plain(parts).length).toBeLessThanOrEqual(122);
  });

  test('finds individual case-insensitive prefix terms in an OR query', () => {
    const parts = searchExcerpt([{ type: 'markdown', data: 'Introduction. '.repeat(30) + 'ANSWER to the question' }], 'missing ans*');
    expect(plain(parts)).toContain('ANSWER');
    expect(matches(parts)).toEqual(['ANS']);
  });

  test('centers the actual word prefix rather than an earlier substring', () => {
    const parts = searchExcerpt([{ type: 'markdown', data: 'We concatenate strings. ' + 'Background. '.repeat(25) + 'A cat sits here.' }], 'cat');
    expect(plain(parts)).toContain('A cat sits here.');
    expect(plain(parts)).not.toContain('concatenate');
    expect(matches(parts)).toEqual(['cat']);
  });

  test('rich text removes markup but preserves paragraph boundaries and decodes entities', () => {
    const parts = searchExcerpt([{ type: 'text', data: '<p>First</p><p>Fish &amp; chips &#x1F41F; &lt;tag&gt;</p><script>unwanted()</script>' }], 'chips');
    expect(plain(parts)).toBe('First Fish & chips 🐟 <tag>');
    expect(matches(parts)).toEqual(['chips']);
  });

  test('keeps code comparisons and HTML-like code as literal text pieces', () => {
    const parts = searchExcerpt([{ type: 'code', data: '<img src=x onerror=alert(1)>\nif (a < b && c > d) return a.b;' }], 'a.b');
    expect(plain(parts)).toBe('<img src=x onerror=alert(1)> if (a < b && c > d) return a.b;');
    expect(matches(parts)).toEqual(['a.b']);
    expect(parts.every(part => typeof part.text === 'string')).toBe(true);
  });

  test('uses the start of the body for title-only matches and excludes resource IDs', () => {
    const parts = searchExcerpt([{ type: 'markdown', data: 'Opening text ![photo](notch-resource://hidden-id)' }], 'title-only');
    expect(matches(parts)).toEqual([]);
    expect(plain(parts)).toBe('Opening text ![photo]()');
    expect(searchExcerpt([], 'anything')).toEqual([]);
  });
});
