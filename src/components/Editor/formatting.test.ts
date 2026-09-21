import { expect, test } from 'bun:test';
import { formatMarkdownSelection } from './formatting';

test('bold wraps the selected text and keeps the interior selected', () => {
  expect(formatMarkdownSelection('one two three', 4, 7, 'bold')).toEqual({ data: 'one **two** three', start: 6, end: 9 });
});

test('empty inline formatting places the caret between the markers', () => {
  expect(formatMarkdownSelection('hello ', 6, 6, 'code')).toEqual({ data: 'hello ``', start: 7, end: 7 });
});

test('list formatting uses complete selected lines without changing the next line', () => {
  expect(formatMarkdownSelection('one\ntwo\nthree', 0, 8, 'numbered')).toEqual({ data: '1. one\n2. two\nthree', start: 0, end: 13 });
});

test('heading inserted in the middle of a line preserves the caret location', () => {
  expect(formatMarkdownSelection('one\nsecond line', 10, 10, 'h2')).toEqual({ data: 'one\n## second line', start: 13, end: 13 });
});
