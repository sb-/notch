import { expect, test } from 'bun:test';
import { highlightMarkdownSource } from './markdownHighlight';

test('leaves intraword underscores unhighlighted', () => {
  expect(highlightMarkdownSource('fw_test')).toBe('fw_test');
  expect(highlightMarkdownSource('a_b_c')).toBe('a_b_c');
  expect(highlightMarkdownSource('lambda_λ')).toBe('lambda_λ');
  expect(highlightMarkdownSource('λ_test')).toBe('λ_test');
});

test('does not carry bad underscore emphasis across lines', () => {
  const html = highlightMarkdownSource('fw_test\nnext line _ stop');

  expect(html).toBe('fw_test\nnext line _ stop');
  expect(html).not.toContain('hljs-emphasis');
});

test('still highlights valid underscore emphasis and strong text', () => {
  expect(highlightMarkdownSource('hello _ok_ world')).toContain('class="hljs-emphasis"');
  expect(highlightMarkdownSource('hello __ok__ world')).toContain('class="hljs-strong"');
});

test('does not highlight underscore emphasis with bad word boundaries', () => {
  expect(highlightMarkdownSource('_test_foo')).toBe('_test_foo');
  expect(highlightMarkdownSource('foo_test_')).toBe('foo_test_');
  expect(highlightMarkdownSource('__test__foo')).toBe('__test__foo');
  expect(highlightMarkdownSource('foo__test__')).toBe('foo__test__');
});
