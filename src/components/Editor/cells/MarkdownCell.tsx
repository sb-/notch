import { useState, useRef, useEffect, useMemo } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';

interface MarkdownCellProps {
  data: string;
  onChange: (data: string) => void;
  onFocus: () => void;
  isFocused?: boolean;
  onBackspaceEmpty?: () => void;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
}

// Configure marked with highlight.js and custom code renderer
marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    code(code: string, infostring?: string) {
      const lang = infostring || '';
      if (lang && hljs.getLanguage(lang)) {
        try {
          const highlighted = hljs.highlight(code, { language: lang }).value;
          return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
        } catch {
          // Fall through to default
        }
      }
      return `<pre><code>${code}</code></pre>`;
    },
  },
});

export default function MarkdownCell({ data, onChange, onFocus, isFocused, onBackspaceEmpty, onNavigatePrev, onNavigateNext }: MarkdownCellProps) {
  const [isEditing, setIsEditing] = useState(!data);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wasEditing = useRef(isEditing);

  const html = useMemo(() => {
    if (!data) return '';
    try {
      return marked.parse(data) as string;
    } catch {
      return data;
    }
  }, [data]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      // Move cursor to end
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

  const handleBlur = (e: React.FocusEvent) => {
    // Don't exit editing if clicking within the same cell
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (relatedTarget && e.currentTarget.contains(relatedTarget)) {
      return;
    }
    setIsEditing(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Delete cell on backspace when empty
    if (e.key === 'Backspace' && !data.trim() && onBackspaceEmpty) {
      e.preventDefault();
      onBackspaceEmpty();
      return;
    }
    // Exit editing mode on Escape
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
    // Allow Tab for indentation
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = data.substring(0, start) + '  ' + data.substring(end);
      onChange(newValue);
      // Move cursor after the inserted spaces
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
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
    );
  }

  return (
    <div
      className="markdown-preview"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
