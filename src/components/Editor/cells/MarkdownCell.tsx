import { useRef, useEffect, useMemo, useState } from 'react';
import { createResourceFromFile, RESOURCE_PROTOCOL } from '../../../services/resources';
import { highlightMarkdownSource } from '../../../services/markdownHighlight';

interface MarkdownCellProps {
  noteId: string;
  data: string;
  onChange: (data: string) => void;
  onFocus: () => void;
  isFocused?: boolean;
  onBackspaceEmpty?: () => void;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
}

// Above this size, skip highlighting and render plain text so very large cells
// stay responsive (highlighting is O(n) per keystroke).
const HIGHLIGHT_LIMIT = 50_000;
// Re-colour the overlay this long after typing pauses. While typing we show
// instant plain text; colours catch up once the burst ends.
const HIGHLIGHT_DEBOUNCE_MS = 80;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Trailing newline keeps the final line/caret visible behind the textarea.
function buildOverlayHtml(src: string): string {
  if (src.length > HIGHLIGHT_LIMIT) return `${escapeHtml(src)}\n`;
  try {
    return `${highlightMarkdownSource(src)}\n`;
  } catch {
    return `${escapeHtml(src)}\n`;
  }
}

export default function MarkdownCell({ noteId, data, onChange, onFocus, isFocused, onBackspaceEmpty, onNavigatePrev, onNavigateNext }: MarkdownCellProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // The transparent textarea shows nothing itself — the visible text is the <pre>
  // highlight layer behind it. highlight.js has no incremental mode, so colouring
  // the whole source on every keystroke is O(n) and reads as typing lag in large
  // cells. So we render escaped plain text instantly (keeps the caret aligned and
  // the just-typed character visible) and recompute the colours on a short
  // debounce once typing pauses. First mount highlights synchronously so opening a
  // note isn't a flash of uncoloured text.
  const [highlighted, setHighlighted] = useState(() => ({ src: data, html: buildOverlayHtml(data) }));

  // Cheap, always-current overlay used while typing.
  const plainHtml = useMemo(() => `${escapeHtml(data)}\n`, [data]);

  // Use the coloured version only when it matches the current text, so a stale
  // highlight never hides freshly-typed characters.
  const highlightedHtml = highlighted.src === data ? highlighted.html : plainHtml;

  useEffect(() => {
    if (highlighted.src === data) return;
    const handle = setTimeout(() => {
      setHighlighted({ src: data, html: buildOverlayHtml(data) });
    }, HIGHLIGHT_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [data, highlighted.src]);

  // Focus this cell's editor when it becomes the focused cell (e.g. via keyboard
  // navigation), without stealing focus while the user types elsewhere.
  useEffect(() => {
    const ta = textareaRef.current;
    if (isFocused && ta && document.activeElement !== ta) {
      ta.focus();
    }
  }, [isFocused]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  // Insert markdown text at the current cursor position (or replace selection).
  const insertAtCursor = (snippet: string) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? data.length;
    const end = textarea?.selectionEnd ?? data.length;
    const next = data.slice(0, start) + snippet + data.slice(end);
    onChange(next);
    setTimeout(() => {
      if (textarea) {
        const pos = start + snippet.length;
        textarea.selectionStart = textarea.selectionEnd = pos;
      }
    }, 0);
  };

  const insertImageFiles = async (files: File[]) => {
    const images = files.filter(file => file.type.startsWith('image/'));
    if (images.length === 0) return;
    for (const file of images) {
      const id = await createResourceFromFile(noteId, file);
      const alt = file.name.replace(/\.[^.]+$/, '');
      insertAtCursor(`\n![${alt}](${RESOURCE_PROTOCOL}${id})\n`);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.some(file => file.type.startsWith('image/'))) {
      e.preventDefault();
      void insertImageFiles(files);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.dataTransfer.files);
    if (files.some(file => file.type.startsWith('image/'))) {
      e.preventDefault();
      void insertImageFiles(files);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    if (e.key === 'Backspace' && data === '' && onBackspaceEmpty) {
      e.preventDefault();
      onBackspaceEmpty();
      return;
    }
    if (e.key === 'Escape') {
      textarea.blur();
    }
    if (e.key === 'ArrowUp' && onNavigatePrev) {
      const { selectionStart } = textarea;
      const textBeforeCursor = data.substring(0, selectionStart);
      if (!textBeforeCursor.includes('\n')) {
        e.preventDefault();
        onNavigatePrev();
      }
    } else if (e.key === 'ArrowDown' && onNavigateNext) {
      const { selectionStart } = textarea;
      const textAfterCursor = data.substring(selectionStart);
      if (!textAfterCursor.includes('\n')) {
        e.preventDefault();
        onNavigateNext();
      }
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = data.substring(0, start) + '  ' + data.substring(end);
      onChange(newValue);
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }, 0);
    }
  };

  // Highlight overlay: a <pre> shows the syntax-highlighted source and sets the
  // height; the transparent <textarea> on top captures input. The two share
  // identical text metrics so they stay aligned.
  return (
    <div className="markdown-editor">
      <pre className="markdown-editor-highlight" aria-hidden="true">
        <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
      </pre>
      <textarea
        ref={textareaRef}
        className="markdown-editor-input"
        value={data}
        spellCheck={false}
        onChange={handleChange}
        onFocus={onFocus}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onDrop={handleDrop}
      />
    </div>
  );
}
