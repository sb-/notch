import React, { useRef, useEffect, useCallback } from 'react';
import DOMPurify from 'dompurify';

interface TextCellProps {
  data: string;
  onChange: (data: string) => void;
  onFocus: () => void;
  isFocused?: boolean;
  onBackspaceEmpty?: () => void;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
}

// Configure DOMPurify to allow safe HTML elements and attributes
const sanitizeConfig: DOMPurify.Config = {
  ALLOWED_TAGS: [
    'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote', 'pre', 'code',
    'a', 'span', 'div',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'hr', 'sub', 'sup',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style'],
  ALLOW_DATA_ATTR: false,
  // Allow custom protocols for internal links
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|notch|quiver-note-url):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
};

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, sanitizeConfig);
}

export default function TextCell({
  data,
  onChange,
  onFocus,
  isFocused,
  onBackspaceEmpty,
  onNavigatePrev,
  onNavigateNext,
}: TextCellProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isComposing = useRef(false);
  const initializedRef = useRef(false);

  // Set initial content only once on mount
  useEffect(() => {
    if (editorRef.current && !initializedRef.current) {
      editorRef.current.innerHTML = sanitizeHtml(data);
      initializedRef.current = true;
    }
  }, []);

  // Handle input changes - just notify parent, don't touch DOM
  const handleInput = useCallback(() => {
    if (editorRef.current && !isComposing.current) {
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  const handleCompositionStart = () => {
    isComposing.current = true;
  };

  const handleCompositionEnd = () => {
    isComposing.current = false;
    handleInput();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    if (!editor) return;

    const isEmpty = !editor.textContent?.trim();

    if (e.key === 'Backspace' && isEmpty && onBackspaceEmpty) {
      e.preventDefault();
      onBackspaceEmpty();
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    if (e.key === 'ArrowUp' && onNavigatePrev) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const editorRect = editor.getBoundingClientRect();
      if (rect.top - editorRect.top < 20) {
        e.preventDefault();
        onNavigatePrev();
      }
    } else if (e.key === 'ArrowDown' && onNavigateNext) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const editorRect = editor.getBoundingClientRect();
      if (editorRect.bottom - rect.bottom < 20) {
        e.preventDefault();
        onNavigateNext();
      }
    }
  };

  // Auto-focus when cell becomes focused
  useEffect(() => {
    if (isFocused && editorRef.current) {
      editorRef.current.focus();
      // Place cursor at end
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editorRef.current);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }, [isFocused]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const content = html ? sanitizeHtml(html) : text;
    document.execCommand('insertHTML', false, content);
  }, []);

  // Use native event listener for link clicks - React events don't work well with contentEditable
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const handleLinkClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Walk up to find anchor
      let el: HTMLElement | null = target;
      while (el && el !== editor) {
        if (el.tagName === 'A') {
          const href = el.getAttribute('href');
          console.log('TextCell native click on link:', href);
          if (href && (href.startsWith('notch://') || href.startsWith('quiver-note-url'))) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            console.log('TextCell: Dispatching navigate event for:', href);
            window.dispatchEvent(new CustomEvent('notch-navigate', { detail: { href } }));
          }
          return;
        }
        el = el.parentElement;
      }
    };

    // Use capture phase to get event before contentEditable
    editor.addEventListener('click', handleLinkClick, true);
    return () => editor.removeEventListener('click', handleLinkClick, true);
  }, []);

  return (
    <div
      ref={editorRef}
      className="cell-textarea cell-richtext"
      contentEditable
      onInput={handleInput}
      onFocus={onFocus}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      suppressContentEditableWarning
    />
  );
}
