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

// Configure marked with highlight.js and custom renderers
marked.use({
  gfm: true,
  breaks: true,
  // Disable auto-linking of raw URLs - only explicit [text](url) links should work
  tokenizer: {
    url() { return undefined; },
  },
  renderer: {
    // Custom link renderer to preserve notch:// and quiver-note-url:// protocols
    link(href: string, title: string | null | undefined, text: string) {
      const titleAttr = title ? ` title="${title}"` : '';
      return `<a href="${href}"${titleAttr}>${text}</a>`;
    },
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
  const wasFocused = useRef(isFocused);

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
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [isEditing]);

  // Enter edit mode when this cell becomes the focused cell (matches
  // text/code cell behavior — focus puts the cursor in the editable surface).
  useEffect(() => {
    if (isFocused && !wasFocused.current && !isEditing) {
      setIsEditing(true);
    }
    wasFocused.current = isFocused;
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
