import React, { useRef, useEffect, useCallback } from 'react';
import { sanitizeRichText } from '../../../services/html';
import {
  createResourceFromFile,
  resolveResourceHtml,
  dehydrateResourceHtml,
  getResourceDataUrl,
  useResourceVersion,
  RESOURCE_PROTOCOL,
} from '../../../services/resources';

interface TextCellProps {
  noteId: string;
  data: string;
  onChange: (data: string) => void;
  onFocus: () => void;
  isFocused?: boolean;
  onBackspaceEmpty?: () => void;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
}

export default function TextCell({
  noteId,
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
  const resourceVersion = useResourceVersion();

  // Set initial content only once on mount (with resource refs resolved to data URLs).
  useEffect(() => {
    if (editorRef.current && !initializedRef.current) {
      editorRef.current.innerHTML = sanitizeRichText(resolveResourceHtml(data));
      initializedRef.current = true;
    }
    // Initialize once on mount; cells remount (keyed by id) when the note changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When resources finish loading (or change), point any unresolved <img> at the
  // freshly-cached data URL without rewriting the whole editor (preserves cursor).
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.querySelectorAll('img[data-resource-id]').forEach(img => {
      const id = img.getAttribute('data-resource-id');
      const src = img.getAttribute('src') ?? '';
      if (id && (src.startsWith(RESOURCE_PROTOCOL) || !src)) {
        const url = getResourceDataUrl(id);
        if (url) img.setAttribute('src', url);
      }
    });
  }, [resourceVersion]);

  // Handle input changes - store the dehydrated form (resource refs, not data URLs).
  const handleInput = useCallback(() => {
    if (editorRef.current && !isComposing.current) {
      onChange(dehydrateResourceHtml(editorRef.current.innerHTML));
    }
  }, [onChange]);

  const handleCompositionStart = () => {
    isComposing.current = true;
  };

  const handleCompositionEnd = () => {
    isComposing.current = false;
    handleInput();
  };

  const insertImageFiles = useCallback(async (files: File[]) => {
    const images = files.filter(file => file.type.startsWith('image/'));
    if (images.length === 0) return;
    for (const file of images) {
      const id = await createResourceFromFile(noteId, file);
      const url = getResourceDataUrl(id) ?? '';
      document.execCommand(
        'insertHTML',
        false,
        `<img src="${url}" data-resource-id="${id}" alt="${file.name.replace(/"/g, '')}" />`
      );
    }
    handleInput();
  }, [noteId, handleInput]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    if (!editor) return;

    const isEmpty = !editor.textContent?.trim() && !editor.querySelector('img');

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
    const files = Array.from(e.clipboardData.files);
    if (files.some(file => file.type.startsWith('image/'))) {
      e.preventDefault();
      void insertImageFiles(files);
      return;
    }
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (html) {
      document.execCommand('insertHTML', false, sanitizeRichText(html));
    } else {
      document.execCommand('insertText', false, text);
    }
  }, [insertImageFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files);
    if (files.some(file => file.type.startsWith('image/'))) {
      e.preventDefault();
      void insertImageFiles(files);
    }
  }, [insertImageFiles]);

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
          if (href && (href.startsWith('notch://') || href.startsWith('quiver-note-url'))) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
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
      onDrop={handleDrop}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      suppressContentEditableWarning
    />
  );
}
