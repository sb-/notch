import React, { useState, useRef, useEffect, useMemo } from 'react';
import katex from 'katex';

interface LatexCellProps {
  data: string;
  onChange: (data: string) => void;
  onFocus: () => void;
  isFocused?: boolean;
  focusRequest?: number;
  onBackspaceEmpty?: () => void;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
}

export default function LatexCell({ data, onChange, onFocus, isFocused, focusRequest, onBackspaceEmpty, onNavigatePrev, onNavigateNext }: LatexCellProps) {
  const [isEditing, setIsEditing] = useState(!data);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const html = useMemo(() => {
    if (!data.trim()) {
      setError(null);
      return '<span style="color: var(--text-tertiary)">Click to edit LaTeX...</span>';
    }

    try {
      const rendered = katex.renderToString(data, {
        displayMode: true,
        throwOnError: true,
        output: 'html',
        trust: true,
        strict: false,
      });
      setError(null);
      return rendered;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid LaTeX';
      setError(message);
      return `<span style="color: var(--danger-color)">${message}</span>`;
    }
  }, [data]);

  useEffect(() => {
    if (isEditing && isFocused && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [isEditing, isFocused, focusRequest]);

  // Keyboard navigation (including Return from the title) enters the source editor.
  useEffect(() => {
    if (isFocused) setIsEditing(true);
  }, [isFocused, focusRequest]);

  const handleClick = () => {
    setIsEditing(true);
    onFocus();
  };

  const handleBlur = () => {
    setIsEditing(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
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
      setIsEditing(false);
    }
    // Arrow key navigation between cells
    if (e.key === 'ArrowUp' && onNavigatePrev) {
      const { selectionStart } = textarea;
      const textBeforeCursor = data.substring(0, selectionStart);
      // Only navigate if we're on the first line (no newline before cursor)
      if (!textBeforeCursor.includes('\n')) {
        e.preventDefault();
        onNavigatePrev();
      }
    } else if (e.key === 'ArrowDown' && onNavigateNext) {
      const { selectionStart } = textarea;
      const textAfterCursor = data.substring(selectionStart);
      // Only navigate if we're on the last line (no newline after cursor)
      if (!textAfterCursor.includes('\n')) {
        e.preventDefault();
        onNavigateNext();
      }
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [data, isEditing]);

  if (isEditing) {
    return (
      <div>
        <textarea
          ref={textareaRef}
          className="cell-editor"
          aria-label="LaTeX cell"
          value={data}
          onChange={handleChange}
          onFocus={onFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="Enter LaTeX, e.g., \sum_{i=1}^{n} x_i"
        />
        {error && (
          <div className="latex-error">{error}</div>
        )}
      </div>
    );
  }

  return (
    <div
      className="latex-preview"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
