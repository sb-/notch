import { test, expect, describe } from 'bun:test';
import { rewriteQuiverLinksInText } from './database';

// A resolved Quiver UUID -> Notch note id map. Keys are lowercase, matching how
// rewriteQuiverNoteLinks builds the map (case-insensitive lookups).
const map = new Map([['a1b2-c3d4', 'note-1']]);

describe('rewriteQuiverLinksInText', () => {
  test('rewrites the canonical quiver-note-url:// form', () => {
    const { text, rewritten } = rewriteQuiverLinksInText(
      'see [foo](quiver-note-url://a1b2-c3d4)',
      map
    );
    expect(text).toBe('see [foo](notch://note/note-1)');
    expect(rewritten).toBe(1);
  });

  test('rewrites the bare slash form that previously crashed (issue #2)', () => {
    // `quiver-note-url/UUID` -- no colon, single slash.
    const { text, rewritten } = rewriteQuiverLinksInText('quiver-note-url/a1b2-c3d4', map);
    expect(text).toBe('notch://note/note-1');
    expect(rewritten).toBe(1);
  });

  test('rewrites the colon-only form', () => {
    const { text } = rewriteQuiverLinksInText('quiver-note-url:a1b2-c3d4', map);
    expect(text).toBe('notch://note/note-1');
  });

  test('matches UUIDs case-insensitively', () => {
    const { text, rewritten } = rewriteQuiverLinksInText('quiver-note-url://A1B2-C3D4', map);
    expect(text).toBe('notch://note/note-1');
    expect(rewritten).toBe(1);
  });

  test('rewrites every link when several appear in one string', () => {
    const m = new Map([
      ['aaaa', 'note-a'],
      ['bbbb', 'note-b'],
    ]);
    const { text, rewritten } = rewriteQuiverLinksInText(
      'first quiver-note-url://aaaa then quiver-note-url://bbbb',
      m
    );
    expect(text).toBe('first notch://note/note-a then notch://note/note-b');
    expect(rewritten).toBe(2);
  });

  test('leaves links whose UUID is not in the map untouched', () => {
    const { text, rewritten } = rewriteQuiverLinksInText(
      'quiver-note-url://deadbeef',
      map
    );
    expect(text).toBe('quiver-note-url://deadbeef');
    expect(rewritten).toBe(0);
  });

  test('returns text unchanged when there are no quiver links', () => {
    const input = 'just some [markdown](https://example.com) text';
    const { text, rewritten } = rewriteQuiverLinksInText(input, map);
    expect(text).toBe(input);
    expect(rewritten).toBe(0);
  });
});
