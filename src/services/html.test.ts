import { describe, expect, test } from 'bun:test';
import { sanitizeInlineStyle } from './html';

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
});
