import { test, expect } from 'bun:test';
import { renderMarkdown } from './markdown';

test('renders width-only size suffix `=300x`', () => {
  const html = renderMarkdown('![cat](https://example.com/cat.png =300x)');
  expect(html).toContain('src="https://example.com/cat.png"');
  expect(html).toContain('width="300"');
  expect(html).not.toContain('height=');
});

test('renders width and height `=300x200`', () => {
  const html = renderMarkdown('![cat](https://example.com/cat.png =300x200)');
  expect(html).toContain('width="300"');
  expect(html).toContain('height="200"');
});

test('renders height-only size suffix `=x200`', () => {
  const html = renderMarkdown('![cat](https://example.com/cat.png =x200)');
  expect(html).toContain('height="200"');
  expect(html).not.toContain('width=');
});

test('preserves alt text and title alongside size', () => {
  const html = renderMarkdown('![a cat](https://example.com/cat.png =300x "Tabby")');
  expect(html).toContain('alt="a cat"');
  expect(html).toContain('title="Tabby"');
  expect(html).toContain('width="300"');
});

test('escaped `]` in alt is supported and unescaped', () => {
  const html = renderMarkdown('![a \\] b](https://example.com/cat.png =400x)');
  expect(html).toContain('alt="a ] b"');
  expect(html).toContain('width="400"');
});

test('plain images without a size suffix are unaffected', () => {
  const html = renderMarkdown('![cat](https://example.com/cat.png)');
  expect(html).toContain('src="https://example.com/cat.png"');
  expect(html).not.toContain('width=');
  expect(html).not.toContain('height=');
});

test('`=x` with no dimensions is not treated as a size suffix', () => {
  // The bare `=x` should not produce width/height attributes. (marked's
  // built-in image rule drops the image because of the space, which is the
  // pre-existing behavior for a malformed suffix.)
  const html = renderMarkdown('![cat](https://example.com/cat.png =x)');
  expect(html).not.toContain('width=');
  expect(html).not.toContain('height=');
});
