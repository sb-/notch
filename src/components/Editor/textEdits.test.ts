import { describe, expect, test } from 'bun:test';
import { cellKeyIntent, clampOffset, estimateEditorHeight, markdownImageSnippet, minimalReplacement, type CellKeyState } from './textEdits';
import { formatMarkdownSelection } from './formatting';

function apply(before: string, change: { start: number; end: number; text: string }): string {
  return before.slice(0, change.start) + change.text + before.slice(change.end);
}

describe('minimalReplacement', () => {
  test('identical text needs no change', () => {
    expect(minimalReplacement('same', 'same')).toEqual({ start: 4, end: 4, text: '' });
  });

  test('insertion keeps the shared prefix and suffix', () => {
    expect(minimalReplacement('one three', 'one two three')).toEqual({ start: 5, end: 5, text: 'wo t' });
  });

  test('deletion replaces the removed span with nothing', () => {
    expect(minimalReplacement('one two three', 'one three')).toEqual({ start: 5, end: 9, text: '' });
  });

  test('repeated characters never produce an overlapping range', () => {
    const change = minimalReplacement('aaa', 'aaaa');
    expect(change.end).toBeGreaterThanOrEqual(change.start);
    expect(apply('aaa', change)).toBe('aaaa');
  });

  test('toolbar formatting results round-trip through the replacement', () => {
    const before = 'one\ntwo\nthree';
    const result = formatMarkdownSelection(before, 0, 8, 'bullet');
    const change = minimalReplacement(before, result.data);
    expect(apply(before, change)).toBe(result.data);
    expect(change.start).toBe(0);
  });

  test('does not split surrogate pairs', () => {
    expect(minimalReplacement('a😀b', 'a😁b')).toEqual({ start: 1, end: 3, text: '😁' });
  });

  test('round-trips arbitrary edits', () => {
    const cases: [string, string][] = [['', 'abc'], ['abc', ''], ['abcabc', 'abXabc'], ['line\n\nline', 'line\nline'], ['😀a', '😀b'], ['😀', '😁'], ['x😀😀y', 'x😀y']];
    for (const [before, after] of cases) expect(apply(before, minimalReplacement(before, after))).toBe(after);
  });
});

test('clampOffset bounds offsets to the text', () => {
  expect(clampOffset(-3, 10)).toBe(0);
  expect(clampOffset(4.7, 10)).toBe(4);
  expect(clampOffset(99, 10)).toBe(10);
  expect(clampOffset(Number.NaN, 10)).toBe(10);
});

test('markdownImageSnippet strips the extension and escapes link syntax', () => {
  expect(markdownImageSnippet('photo.png', 'notch-resource://1')).toBe('\n![photo](notch-resource://1)\n');
  expect(markdownImageSnippet('a [b].final.jpg', 'x')).toBe('\n![a \\[b\\].final](x)\n');
});

test('estimateEditorHeight counts logical lines with a floor', () => {
  expect(estimateEditorHeight('', 20, 20)).toBe(20);
  expect(estimateEditorHeight('a\nb\nc', 21, 29, 8)).toBe(71);
  expect(estimateEditorHeight('a', 21, 29, 8)).toBe(29);
});

describe('cellKeyIntent', () => {
  const base: CellKeyState = {
    key: 'ArrowUp', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false,
    isEmpty: false, selectionEmpty: true, onFirstRow: false, onLastRow: false,
  };

  test('Backspace in an empty cell removes it, even with modifiers', () => {
    expect(cellKeyIntent({ ...base, key: 'Backspace', isEmpty: true })).toBe('backspace-empty');
    expect(cellKeyIntent({ ...base, key: 'Backspace', isEmpty: true, altKey: true })).toBe('backspace-empty');
    expect(cellKeyIntent({ ...base, key: 'Backspace', isEmpty: false })).toBeNull();
  });

  test('Up on the first row and Down on the last row leave the cell', () => {
    expect(cellKeyIntent({ ...base, key: 'ArrowUp', onFirstRow: true })).toBe('navigate-prev');
    expect(cellKeyIntent({ ...base, key: 'ArrowDown', onLastRow: true })).toBe('navigate-next');
    expect(cellKeyIntent({ ...base, key: 'ArrowUp', onLastRow: true })).toBeNull();
    expect(cellKeyIntent({ ...base, key: 'ArrowDown', onFirstRow: true })).toBeNull();
  });

  test('selection, modifiers and IME composition stay in the editor', () => {
    expect(cellKeyIntent({ ...base, onFirstRow: true, selectionEmpty: false })).toBeNull();
    for (const modifier of ['shiftKey', 'altKey', 'ctrlKey', 'metaKey'] as const) {
      expect(cellKeyIntent({ ...base, onFirstRow: true, [modifier]: true })).toBeNull();
    }
    expect(cellKeyIntent({ ...base, onFirstRow: true, isComposing: true })).toBeNull();
    expect(cellKeyIntent({ ...base, key: 'Backspace', isEmpty: true, isComposing: true })).toBeNull();
  });
});
