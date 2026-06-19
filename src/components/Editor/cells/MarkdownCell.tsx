import { useRef, useEffect, useLayoutEffect } from 'react';
import { createResourceFromFile, RESOURCE_PROTOCOL } from '../../../services/resources';

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

export default function MarkdownCell({ noteId, data, onChange, onFocus, isFocused, onBackspaceEmpty, onNavigatePrev, onNavigateNext }: MarkdownCellProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize to fit content so the whole cell is visible (no inner scroll /
  // overflow). useLayoutEffect runs after the value is in the DOM, so scrollHeight
  // is accurate even for large pasted content on first mount.
  const adjustHeight = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  };

  useLayoutEffect(() => {
    adjustHeight();
  }, [data]);

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

    if (e.key === 'Backspace' && !data.trim() && onBackspaceEmpty) {
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

  // The editor pane always shows raw, editable Markdown. Rendered Markdown is the
  // job of the preview pane (NotePreview) — keeping this a textarea is the point
  // of having a separate view panel.
  return (
    <textarea
      ref={textareaRef}
      className="cell-editor"
      value={data}
      onChange={handleChange}
      onFocus={onFocus}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onDrop={handleDrop}
    />
  );
}
