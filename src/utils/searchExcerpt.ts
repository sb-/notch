import type { Cell } from '../types';
import { searchTerms } from './searchTerms';

export interface SearchExcerptPart {
  text: string;
  matched: boolean;
}

const entities: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

function decodeEntity(entity: string, name: string): string {
  if (!name.startsWith('#')) return entities[name] ?? entity;
  const codePoint = name[1]?.toLowerCase() === 'x'
    ? Number.parseInt(name.slice(2), 16)
    : Number.parseInt(name.slice(1), 10);
  return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
    ? String.fromCodePoint(codePoint)
    : '\uFFFD';
}

function cellText(cell: Pick<Cell, 'type' | 'data'>): string {
  let text = cell.data;
  if (cell.type === 'text') {
    text = text
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<\/?(?:p|div|br|li|h[1-6]|tr|td|th|blockquote|pre|hr)\b[^>]*>/gi, ' ')
      .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, '')
      .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, decodeEntity);
  }
  // Source code keeps its angle brackets. Embedded resource IDs are not useful
  // context and are also excluded from the full-text index.
  return text.replace(/notch-resource:\/\/[\w-]+/g, '').replace(/\s+/g, ' ').trim();
}

function nextTermMatch(text: string, pattern: RegExp): RegExpExecArray | null {
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    // FTS prefix matching starts at a word boundary. Do not choose "concatenate"
    // as the explanation for a later "cat" match.
    const preceding = text.slice(Math.max(0, match.index - 2), match.index);
    if (!/[\p{L}\p{N}\p{M}]$/u.test(preceding)) return match;
  }
  return null;
}

/** Return text pieces for React to render, never a string of highlighted HTML. */
export function searchExcerpt(
  cells: readonly Pick<Cell, 'type' | 'data'>[],
  query: string,
  maxLength = 120,
): SearchExcerptPart[] {
  const text = cells.map(cellText).filter(Boolean).join(' ');
  if (!text) return [];

  // Mirror the search service's literal OR/prefix terms, including multiword
  // searches whose words need not occur next to one another.
  const terms = searchTerms(query).sort((a, b) => b.length - a.length);
  const pattern = terms.length
    ? new RegExp(terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'giu')
    : null;
  const firstMatch = pattern ? nextTermMatch(text, pattern) : null;
  const length = Math.max(1, Math.floor(maxLength));
  const context = Math.min(24, Math.floor(length / 4));
  let start = text.length <= length ? 0 : Math.max(0, (firstMatch?.index ?? 0) - context);
  // Prefer a whole word at the start when doing so does not remove the match.
  const nextSpace = text.indexOf(' ', start);
  if (start > 0 && nextSpace >= start && nextSpace < (firstMatch?.index ?? 0)) start = nextSpace + 1;
  const end = Math.min(text.length, Math.max(start + length, (firstMatch?.index ?? 0) + (firstMatch?.[0].length ?? 0)));
  const excerpt = text.slice(start, end);
  const parts: SearchExcerptPart[] = [];
  if (start > 0) parts.push({ text: '…', matched: false });
  let cursor = 0;
  if (pattern) {
    pattern.lastIndex = start;
    let match: RegExpExecArray | null;
    while ((match = nextTermMatch(text, pattern)) && match.index < end) {
      const index = match.index - start;
      if (index > cursor) parts.push({ text: excerpt.slice(cursor, index), matched: false });
      const matchedText = match[0].slice(0, end - match.index);
      parts.push({ text: matchedText, matched: true });
      cursor = index + matchedText.length;
    }
  }
  if (cursor < excerpt.length) parts.push({ text: excerpt.slice(cursor), matched: false });
  if (end < text.length) parts.push({ text: '…', matched: false });
  return parts;
}
