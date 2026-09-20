import { describe, expect, test } from 'bun:test';
import {
  decideTextCellPaste,
  htmlContainsAnchor,
  linkifyPlainText,
  parseStandaloneUrl,
} from './links';

describe('parseStandaloneUrl', () => {
  test('accepts http and https URLs, including surrounding whitespace', () => {
    expect(parseStandaloneUrl('https://example.com')).toEqual({
      href: 'https://example.com',
      display: 'https://example.com',
    });
    expect(parseStandaloneUrl('  http://localhost:1420/path  ')).toEqual({
      href: 'http://localhost:1420/path',
      display: 'http://localhost:1420/path',
    });
  });

  test('prefixes www. URLs with https://', () => {
    expect(parseStandaloneUrl('www.example.com/docs')).toEqual({
      href: 'https://www.example.com/docs',
      display: 'www.example.com/docs',
    });
  });

  test('accepts mailto, tel, and internal note links', () => {
    expect(parseStandaloneUrl('mailto:hi@example.com')?.href).toBe('mailto:hi@example.com');
    expect(parseStandaloneUrl('tel:+15551212')?.href).toBe('tel:+15551212');
    expect(parseStandaloneUrl('notch://note/abc')?.href).toBe('notch://note/abc');
    expect(parseStandaloneUrl('quiver-note-url://uuid')?.href).toBe('quiver-note-url://uuid');
  });

  test('rejects schemes that should not become links', () => {
    expect(parseStandaloneUrl('javascript:alert(1)')).toBeNull();
    expect(parseStandaloneUrl('data:text/html,hi')).toBeNull();
    expect(parseStandaloneUrl('https://')).toBeNull();
    expect(parseStandaloneUrl('www.')).toBeNull();
    expect(parseStandaloneUrl('not a url')).toBeNull();
    expect(parseStandaloneUrl('example.com')).toBeNull();
  });

  test('rejects text that contains more than one token', () => {
    expect(parseStandaloneUrl('see https://example.com')).toBeNull();
    expect(parseStandaloneUrl('https://a.com https://b.com')).toBeNull();
  });
});

describe('htmlContainsAnchor', () => {
  test('detects an anchor with href in a clipboard HTML fragment', () => {
    expect(
      htmlContainsAnchor(
        '<html><body><!--StartFragment--><a href="https://example.com">x</a><!--EndFragment--></body></html>'
      )
    ).toBe(true);
  });

  test('ignores anchors without href and empty html', () => {
    expect(htmlContainsAnchor('<a name="top">top</a>')).toBe(false);
    expect(htmlContainsAnchor('')).toBe(false);
    expect(htmlContainsAnchor('<span>https://example.com</span>')).toBe(false);
  });
});

describe('linkifyPlainText', () => {
  test('wraps URLs inside surrounding text and keeps trailing punctuation outside', () => {
    expect(linkifyPlainText('see https://example.com.')).toBe(
      'see <a href="https://example.com">https://example.com</a>.'
    );
  });

  test('keeps balanced parentheses that belong to the URL', () => {
    expect(
      linkifyPlainText('https://en.wikipedia.org/wiki/Rust_(programming_language)')
    ).toBe(
      '<a href="https://en.wikipedia.org/wiki/Rust_(programming_language)">https://en.wikipedia.org/wiki/Rust_(programming_language)</a>'
    );
  });

  test('strips an unmatched closing paren after the URL', () => {
    expect(linkifyPlainText('(see https://example.com)')).toBe(
      '(see <a href="https://example.com">https://example.com</a>)'
    );
  });

  test('escapes HTML in non-URL text and converts newlines', () => {
    expect(linkifyPlainText('a <b>\nhttps://example.com')).toBe(
      'a &lt;b&gt;<br><a href="https://example.com">https://example.com</a>'
    );
  });

  test('returns null when there is nothing to link', () => {
    expect(linkifyPlainText('just some words')).toBeNull();
    expect(linkifyPlainText('javascript:alert(1)')).toBeNull();
  });
});

describe('decideTextCellPaste', () => {
  test('turns a pasted URL into a hyperlink', () => {
    expect(
      decideTextCellPaste({ html: '', text: 'https://example.com', hasSelection: false })
    ).toEqual({
      action: 'insertHtml',
      html: '<a href="https://example.com">https://example.com</a>',
    });
  });

  test('applies a pasted URL to the current selection', () => {
    expect(
      decideTextCellPaste({ html: '', text: 'https://example.com', hasSelection: true })
    ).toEqual({ action: 'createLink', href: 'https://example.com' });
  });

  test('applies a URL to the selection even when clipboard HTML already has an anchor', () => {
    expect(
      decideTextCellPaste({
        html: '<a href="https://example.com">https://example.com</a>',
        text: 'https://example.com',
        hasSelection: true,
      })
    ).toEqual({ action: 'createLink', href: 'https://example.com' });
  });

  test('keeps existing HTML when the clipboard already contains a link', () => {
    const html = '<a href="https://example.com">docs</a>';
    expect(decideTextCellPaste({ html, text: 'docs', hasSelection: false })).toEqual({
      action: 'insertHtml',
      html,
    });
  });

  test('linkifies a bare URL even if HTML is a non-anchor wrapper', () => {
    expect(
      decideTextCellPaste({
        html: '<span>https://example.com</span>',
        text: 'https://example.com',
        hasSelection: false,
      })
    ).toEqual({
      action: 'insertHtml',
      html: '<a href="https://example.com">https://example.com</a>',
    });
  });

  test('linkifies URLs inside a larger plain-text paste', () => {
    expect(
      decideTextCellPaste({
        html: '',
        text: 'read https://example.com please',
        hasSelection: false,
      })
    ).toEqual({
      action: 'insertHtml',
      html: 'read <a href="https://example.com">https://example.com</a> please',
    });
  });

  test('falls back to insertText when there is no URL and no HTML', () => {
    expect(
      decideTextCellPaste({ html: '', text: 'hello', hasSelection: false })
    ).toEqual({ action: 'insertText', text: 'hello' });
  });
});
