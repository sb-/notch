import type { Note } from '../types';
import { sanitizeRichText } from './html';

export interface NoteMatch { cellId: string; start: number; end: number }
export function findOffsets(text: string, query: string): { start: number; end: number }[] {
  if (!query.trim()) return [];
  // RegExp indices refer to the original string, including Unicode case folds.
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  return Array.from(text.matchAll(pattern), match => ({ start: match.index!, end: match.index! + match[0].length }));
}
export function noteMatches(note: Note, query: string): NoteMatch[] {
  return note.cells.flatMap(cell => {
    let text = cell.data;
    if (cell.type === 'text') {
      const template = document.createElement('template');
      template.innerHTML = sanitizeRichText(text);
      text = template.content.textContent ?? '';
    }
    return findOffsets(text, query).map(match => ({ cellId: cell.id, ...match }));
  });
}

export function clearFind(): void {
  document.querySelectorAll('[data-find-marker]').forEach(el => el.remove());
  document.querySelectorAll('.monaco-container').forEach(el => el.dispatchEvent(new CustomEvent('notch-find', { detail: null })));
}
export function revealMatch(match: NoteMatch): () => void {
  clearFind();
  const cell = Array.from(document.querySelectorAll<HTMLElement>('[data-cell-id]')).find(el => el.dataset.cellId === match.cellId);
  if (!cell) return () => {};
  cell.dispatchEvent(new Event('notch-find-source', { bubbles: true }));
  let cancelled = false;
  const reveal = () => {
    if (cancelled) return;
    cell.querySelectorAll('[data-find-marker]').forEach(el => el.remove());
    // Monaco cells (code, markdown) highlight and scroll themselves and cancel
    // the event. Until Monaco exists they edit through a plain textarea.
    const monaco = cell.querySelector('.monaco-container');
    if (monaco) {
      const event = new CustomEvent('notch-find', { detail: match, cancelable: true });
      monaco.dispatchEvent(event);
      if (event.defaultPrevented) return;
    }
    const editable = cell.querySelector<HTMLElement>('[contenteditable="true"]');
    const textarea = cell.querySelector<HTMLTextAreaElement>('textarea:not(.inputarea)');
    if (editable) {
      const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let offset = 0, start = false, node: Node | null;
      while ((node = walker.nextNode())) {
        const length = node.textContent?.length ?? 0;
        if (!start && offset + length >= match.start) { range.setStart(node, match.start - offset); start = true; }
        if (start && offset + length >= match.end) { range.setEnd(node, match.end - offset); break; }
        offset += length;
      }
      if (start && node) {
        const rects = Array.from(range.getClientRects());
        const scroll = cell.closest<HTMLElement>('.editor-content');
        if (scroll && rects[0]) scroll.scrollTop += rects[0].top - scroll.getBoundingClientRect().top - scroll.clientHeight / 2;
        const bounds = cell.getBoundingClientRect();
        for (const rect of range.getClientRects()) {
          const mark = document.createElement('span');
          mark.dataset.findMarker = '';
          Object.assign(mark.style, { position: 'absolute', pointerEvents: 'none', background: '#ffbf4780', borderBottom: '2px solid #ffbf47', zIndex: '5', left: `${rect.left - bounds.left}px`, top: `${rect.top - bounds.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
          cell.append(mark);
        }
      }
    } else if (textarea) {
      textarea.setSelectionRange(match.start, match.end);
      const line = textarea.value.slice(0, match.start).split('\n').length - 1;
      const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 21;
      textarea.scrollTop = Math.max(0, line * lineHeight - textarea.clientHeight / 2);
      textarea.scrollIntoView({ block: 'center' });
      // Native selection remains visible in editable source when Find keeps focus.
    } else cell.scrollIntoView({ block: 'center' });
  };
  reveal();
  // Source editors and lazy Monaco may mount after the reveal request.
  const timer = setTimeout(reveal, 0);
  const ready = () => reveal();
  cell.addEventListener('notch-editor-ready', ready);
  return () => { cancelled = true; clearTimeout(timer); cell.removeEventListener('notch-editor-ready', ready); clearFind(); };
}
