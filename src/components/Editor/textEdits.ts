// Pure text-editing helpers shared by the Monaco-backed cells and the editor
// toolbar. Nothing here touches the DOM or Monaco, so it is unit-testable.

export interface TextReplacement { start: number; end: number; text: string }

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

// Smallest single replacement that turns `before` into `after` (common prefix
// and suffix are kept). Editing only the changed span keeps carets, undo
// history and decorations outside it stable.
export function minimalReplacement(before: string, after: string): TextReplacement {
  let start = 0;
  const limit = Math.min(before.length, after.length);
  while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let end = before.length;
  let replacementEnd = after.length;
  while (end > start && replacementEnd > start && before.charCodeAt(end - 1) === after.charCodeAt(replacementEnd - 1)) {
    end--;
    replacementEnd--;
  }
  // Never split a surrogate pair (e.g. emoji that share a high surrogate).
  if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) start--;
  if (end < before.length && isLowSurrogate(before.charCodeAt(end))) { end++; replacementEnd++; }
  return { start, end, text: after.slice(start, replacementEnd) };
}

export function clampOffset(offset: number, length: number): number {
  if (!Number.isFinite(offset)) return length;
  return Math.max(0, Math.min(length, Math.trunc(offset)));
}

export function isImageFile(file: { type: string }): boolean {
  return file.type.startsWith('image/');
}

// Markdown inserted for a pasted, dropped or chosen image. The alt text is the
// file name without its extension, with link-breaking characters escaped.
export function markdownImageSnippet(fileName: string, url: string): string {
  const alt = fileName.replace(/\.[^.]+$/, '').replace(/[\[\]\\]/g, '\\$&');
  return `\n![${alt}](${url})\n`;
}

export interface CellKeyState {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  isEmpty: boolean;
  selectionEmpty: boolean;
  onFirstRow: boolean;
  onLastRow: boolean;
}

export type CellKeyIntent = 'backspace-empty' | 'navigate-prev' | 'navigate-next' | null;

// Cell-level keyboard behaviour shared by every source-editing cell: Backspace
// in an empty cell removes it, and unmodified Up/Down at the first/last visual
// row with no selection moves to the neighbouring cell. Selection and modified
// movement belong to the editor itself.
export function cellKeyIntent(state: CellKeyState): CellKeyIntent {
  if (state.isComposing) return null;
  if (state.key === 'Backspace' && state.isEmpty) return 'backspace-empty';
  if (state.shiftKey || state.altKey || state.ctrlKey || state.metaKey || !state.selectionEmpty) return null;
  if (state.key === 'ArrowUp' && state.onFirstRow) return 'navigate-prev';
  if (state.key === 'ArrowDown' && state.onLastRow) return 'navigate-next';
  return null;
}

// Pre-Monaco height estimate: one row per logical line. Exact for unwrapped
// code; a lower bound for wrapped prose (Monaco corrects it once created).
export function estimateEditorHeight(text: string, lineHeight: number, minHeight: number, reserve = 0): number {
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  return Math.max(minHeight, lines * lineHeight + reserve);
}
