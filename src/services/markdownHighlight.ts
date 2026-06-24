import hljs from 'highlight.js';
import markdownLang from 'highlight.js/lib/languages/markdown';
import type { CallbackResponse, Mode } from 'highlight.js';

const SINGLE_UNDERSCORE_BEGIN = /_(?![_\s])/.source;
const DOUBLE_UNDERSCORE_BEGIN = /_{2}(?!\s)/.source;

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

function isWordCharacter(ch: string): boolean {
  return WORD_CHARACTER.test(ch);
}

function isBadUnderscoreBoundary(ch: string): boolean {
  return ch === '_' || isWordCharacter(ch);
}

function hasClosingUnderscoreDelimiter(input: string, start: number, delimiter: '_' | '__'): boolean {
  let index = input.indexOf(delimiter, start);
  while (index !== -1) {
    const next = input[index + delimiter.length] ?? '';
    if (!isBadUnderscoreBoundary(next)) return true;
    index = input.indexOf(delimiter, index + 1);
  }
  return false;
}

function guardUnderscoreEmphasis(delimiter: '_' | '__'): Pick<Mode, 'on:begin' | 'on:end'> {
  return {
    'on:begin': (match: RegExpMatchArray, response: CallbackResponse) => {
      const input = match.input ?? '';
      const index = match.index ?? 0;
      const previous = input[index - 1] ?? '';
      const afterOpeningDelimiter = index + match[0].length;

      if (
        isBadUnderscoreBoundary(previous) ||
        !hasClosingUnderscoreDelimiter(input, afterOpeningDelimiter, delimiter)
      ) {
        response.ignoreMatch();
      }
    },
    'on:end': (match: RegExpMatchArray, response: CallbackResponse) => {
      const input = match.input ?? '';
      const index = match.index ?? 0;
      const next = input[index + match[0].length] ?? '';

      if (isBadUnderscoreBoundary(next)) {
        response.ignoreMatch();
      }
    },
  };
}

function constrainUnderscoreEmphasis(mode: Mode, visited = new Set<Mode>()): void {
  if (visited.has(mode)) return;
  visited.add(mode);

  for (const variant of mode.variants ?? []) {
    if (!(variant.begin instanceof RegExp)) continue;
    if (variant.begin.source === SINGLE_UNDERSCORE_BEGIN) {
      Object.assign(variant, guardUnderscoreEmphasis('_'));
    } else if (variant.begin.source === DOUBLE_UNDERSCORE_BEGIN) {
      Object.assign(variant, guardUnderscoreEmphasis('__'));
    }
  }

  for (const child of mode.contains ?? []) {
    if (child !== 'self') constrainUnderscoreEmphasis(child, visited);
  }
}

hljs.registerLanguage('markdown', (hl) => {
  const definition = markdownLang(hl);
  constrainUnderscoreEmphasis(definition);
  return definition;
});

export function highlightMarkdownSource(src: string): string {
  return hljs.highlight(src, { language: 'markdown', ignoreIllegals: true }).value;
}
