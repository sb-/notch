import React, { useState, useRef, useEffect, useMemo } from 'react';
import katex from 'katex';

interface LatexCellProps {
  data: string;
  onChange: (data: string) => void;
  onFocus: () => void;
  isFocused?: boolean;
  onBackspaceEmpty?: () => void;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
}

export default function LatexCell({ data, onChange, onFocus, isFocused, onBackspaceEmpty, onNavigatePrev, onNavigateNext }: LatexCellProps) {
  const [isEditing, setIsEditing] = useState(!data);
  const wasEditing = useRef(isEditing);
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
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [isEditing]);

  // Auto-enter editing mode when cell becomes focused (for new cells)
  useEffect(() => {
    if (isFocused && !wasEditing.current && !isEditing) {
      setIsEditing(true);
    }
    wasEditing.current = isEditing;
  }, [isFocused, isEditing]);

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

    if (e.key === 'Backspace' && !data.trim() && onBackspaceEmpty) {
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
      if (selectionStart === 0) {
        e.preventDefault();
        onNavigatePrev();
      }
    } else if (e.key === 'ArrowDown' && onNavigateNext) {
      const { selectionStart, selectionEnd } = textarea;
      if (selectionStart === data.length && selectionEnd === data.length) {
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
          value={data}
          onChange={handleChange}
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
