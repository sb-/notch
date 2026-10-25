import { clampOffset, type TextReplacement } from '../textEdits';

// DOM-event protocol between the note editor and source-editing cells. Monaco
// cells (code, markdown) listen on their `.monaco-container`; before Monaco
// loads, or if it fails to, those cells (and LaTeX/diagram cells) expose a
// plain <textarea> instead. Keep this module free of Monaco imports: the note
// editor uses it and Monaco is loaded lazily.

export const READ_SELECTION_EVENT = 'notch-read-selection';
export const APPLY_EDIT_EVENT = 'notch-apply-edit';

export interface CellSelection {
  start: number;
  end: number;
  /** Where the caret is (the active end of the selection). */
  caret: number;
  value: string;
}

export interface ReadSelectionDetail { selection?: CellSelection }

export interface CellEdit extends TextReplacement {
  /** Selection to place after the edit, as offsets into the new text. */
  selection?: { start: number; end: number };
  /** Focus the editor afterwards (the textarea fallback always focuses: execCommand needs it). */
  focus?: boolean;
}

function monacoHost(cell: HTMLElement): HTMLElement | null {
  return cell.querySelector<HTMLElement>('.monaco-container');
}

// Monaco's own hidden input is a textarea with the `inputarea` class.
function plainTextarea(cell: HTMLElement): HTMLTextAreaElement | null {
  return cell.querySelector<HTMLTextAreaElement>('textarea:not(.inputarea)');
}

export function readCellSelection(cell: HTMLElement): CellSelection | null {
  const detail: ReadSelectionDetail = {};
  monacoHost(cell)?.dispatchEvent(new CustomEvent(READ_SELECTION_EVENT, { detail }));
  if (detail.selection) return detail.selection;
  const textarea = plainTextarea(cell);
  if (!textarea) return null;
  const { selectionStart: start, selectionEnd: end, selectionDirection, value } = textarea;
  return { start, end, caret: selectionDirection === 'backward' ? start : end, value };
}

// Replace a range of the cell's source through the active editor so the change
// is a single native undo step. Returns false when no editor could take it.
export function applyCellEdit(cell: HTMLElement, edit: CellEdit): boolean {
  const host = monacoHost(cell);
  if (host) {
    const event = new CustomEvent(APPLY_EDIT_EVENT, { detail: edit, cancelable: true });
    host.dispatchEvent(event);
    if (event.defaultPrevented) return true;
  }
  const textarea = plainTextarea(cell);
  if (!textarea) return false;
  const length = textarea.value.length;
  const start = clampOffset(edit.start, length);
  const end = Math.max(start, clampOffset(edit.end, length));
  textarea.focus();
  textarea.setSelectionRange(start, end);
  // WebKit's insertText creates a real undo transaction and emits the input
  // event React listens for; assigning a controlled value would bypass both.
  if (!document.execCommand('insertText', false, edit.text)) {
    textarea.setRangeText(edit.text, start, end, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (edit.selection) {
    const nextLength = textarea.value.length;
    textarea.setSelectionRange(clampOffset(edit.selection.start, nextLength), clampOffset(edit.selection.end, nextLength));
  }
  return true;
}
