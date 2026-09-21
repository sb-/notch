import { describe, expect, test } from 'bun:test';
import { normalizeForegroundColor, sanitizeInlineStyle } from './html';

describe('sanitizeInlineStyle', () => {
  test('drops layout styles that can escape the text cell', () => {
    expect(
      sanitizeInlineStyle(
        'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 9999; color: red; font-weight: 700'
      )
    ).toBe('color: red; font-weight: 700');
  });

  test('keeps conservative text formatting styles', () => {
    expect(
      sanitizeInlineStyle(
        'font-style: italic; text-decoration: underline line-through; text-align: center; vertical-align: super; white-space: pre-wrap'
      )
    ).toBe(
      'font-style: italic; text-decoration: underline line-through; text-align: center; vertical-align: super; white-space: pre-wrap'
    );
  });

  test('rejects unsafe or non-text color values', () => {
    expect(
      sanitizeInlineStyle(
        'color: var(--accent-color); background-image: url(https://example.com/x.png); color: #336699'
      )
    ).toBe('color: #336699');
  });

  test('removes important flags from retained declarations', () => {
    expect(sanitizeInlineStyle('color: blue !important; font-weight: bold !important')).toBe(
      'color: blue; font-weight: bold'
    );
  });

  test('native clipboard default black inherits the editor theme while keeping formatting', () => {
    expect(sanitizeInlineStyle('color: rgb(0, 0, 0); white-space: normal; font-weight: bold'))
      .toBe('white-space: normal; font-weight: bold');
  });

  test('normalizes opaque black and white clipboard foregrounds in common serializations', () => {
    for (const color of ['black', '#000', '#000000', '#000f', 'rgb(0 0 0)', 'rgba(0,0,0,1)', 'white', '#fff', '#ffffffff', 'rgb(100% 100% 100%)', 'hsl(0, 0%, 100%)']) {
      expect(normalizeForegroundColor(color)).toBeNull();
    }
  });

  test('preserves deliberate color accents and translucent colors', () => {
    expect(sanitizeInlineStyle('color: rgb(34, 139, 230); font-style: italic')).toBe('color: rgb(34, 139, 230); font-style: italic');
    expect(normalizeForegroundColor('rgba(0,0,0,0.5)')).toBe('rgba(0,0,0,0.5)');
    expect(normalizeForegroundColor('#fff8')).toBe('#fff8');
  });
});
