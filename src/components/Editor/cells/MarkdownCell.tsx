import { useState, useRef, useEffect, useMemo } from 'react';
import { renderMarkdown } from '../../../services/markdown';
import { createResourceFromFile, useResourceVersion, RESOURCE_PROTOCOL } from '../../../services/resources';

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
  const [isEditing, setIsEditing] = useState(!data);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const resourceVersion = useResourceVersion();

  const html = useMemo(() => renderMarkdown(data), [data, resourceVersion]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [isEditing]);

  useEffect(() => {
    if (isFocused && !isEditing) {
      previewRef.current?.focus();
    }
  }, [isFocused, isEditing]);

  const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('a')) return;
    setIsEditing(true);
    onFocus();
  };

  const handleBlur = (e: React.FocusEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (relatedTarget && e.currentTarget.contains(relatedTarget)) {
      return;
    }
    setIsEditing(false);
  };

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
      setIsEditing(false);
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

  // Auto-resize textarea
  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [data, isEditing]);

  if (isEditing) {
    return (
      <textarea
        ref={textareaRef}
        className="cell-editor"
        value={data}
        onChange={handleChange}
        onFocus={onFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onDrop={handleDrop}
      />
    );
  }

  return (
    <div
      ref={previewRef}
      className="markdown-preview"
      tabIndex={-1}
      onFocus={onFocus}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
