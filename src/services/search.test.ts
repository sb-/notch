import { test, expect, describe } from 'bun:test';
import { searchWithinNote, highlightMatches } from './search';
import type { Note, Cell } from '../types';

function cell(data: string, id = 'c'): Cell {
  return { id, type: 'text', data, sortOrder: 0 };
}

function note(cells: Cell[]): Note {
  return {
    id: 'n1',
    notebookId: 'nb1',
    title: 'Test note',
    cells,
    tags: [],
    isFavorite: false,
    isTrashed: false,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('searchWithinNote', () => {
  test('finds a match and reports its offsets', () => {
    const results = searchWithinNote(note([cell('hello world')]), 'world');
    expect(results).toEqual([{ cellIndex: 0, matches: [{ start: 6, end: 11 }] }]);
  });

  test('is case insensitive', () => {
    const results = searchWithinNote(note([cell('Hello World')]), 'hello');
    expect(results).toEqual([{ cellIndex: 0, matches: [{ start: 0, end: 5 }] }]);
  });

  test('finds multiple matches within one cell', () => {
    const results = searchWithinNote(note([cell('aa aa aa')]), 'aa');
    expect(results[0].matches).toHaveLength(3);
    expect(results[0].matches.map(m => m.start)).toEqual([0, 3, 6]);
  });

  test('finds overlapping matches', () => {
    // 'aaa' contains 'aa' at offsets 0 and 1 because the scan advances by one.
    const results = searchWithinNote(note([cell('aaa')]), 'aa');
    expect(results[0].matches.map(m => m.start)).toEqual([0, 1]);
  });

  test('reports the correct cell index and skips cells with no match', () => {
    const results = searchWithinNote(
      note([cell('nothing', 'a'), cell('find me', 'b')]),
      'find'
    );
    expect(results).toEqual([{ cellIndex: 1, matches: [{ start: 0, end: 4 }] }]);
  });

  test('returns no results when nothing matches', () => {
    expect(searchWithinNote(note([cell('hello')]), 'xyz')).toEqual([]);
  });
});

describe('highlightMatches', () => {
  test('wraps a match in the default highlight span', () => {
    expect(highlightMatches('hello world', 'world')).toBe(
      'hello <span class="search-highlight">world</span>'
    );
  });

  test('highlights every occurrence, preserving original case', () => {
    expect(highlightMatches('Cat cat CAT', 'cat')).toBe(
      '<span class="search-highlight">Cat</span> ' +
        '<span class="search-highlight">cat</span> ' +
        '<span class="search-highlight">CAT</span>'
    );
  });

  test('accepts a custom highlight class', () => {
    expect(highlightMatches('abc', 'b', 'hit')).toBe('a<span class="hit">b</span>c');
  });

  test('treats regex metacharacters in the query literally', () => {
    expect(highlightMatches('a.b a-b', 'a.b')).toBe(
      '<span class="search-highlight">a.b</span> a-b'
    );
  });

  test('returns the text unchanged for an empty query', () => {
    expect(highlightMatches('hello', '   ')).toBe('hello');
  });
});
