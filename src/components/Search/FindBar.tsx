import { useState, useRef, useEffect, useCallback } from 'react';
import type { Note } from '../../types';
import { searchWithinNote } from '../../services/search';

interface FindBarProps {
  note: Note;
  onClose: () => void;
}

export default function FindBar({ note, onClose }: FindBarProps) {
  const [query, setQuery] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const highlightMatches = useCallback((q: string) => {
    // Clear previous highlights
    document.querySelectorAll('.find-highlight').forEach(el => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent || ''), el);
        parent.normalize();
      }
    });

    if (!q.trim()) {
      setMatchCount(0);
      setCurrentMatch(0);
      return;
    }

    const results = searchWithinNote(note, q);
    const total = results.reduce((sum, r) => sum + r.matches.length, 0);
    setMatchCount(total);
    setCurrentMatch(total > 0 ? 1 : 0);

    // Use the browser's built-in find to highlight (via CSS)
    // Apply highlights to rendered content in editor (handles split mode too)
    const editorContents = document.querySelectorAll('.editor-content');
    if (editorContents.length === 0) return;

    const textNodes: Text[] = [];
    editorContents.forEach(editorContent => {
      const walker = document.createTreeWalker(
        editorContent,
        NodeFilter.SHOW_TEXT,
        null,
      );

      let node;
      while ((node = walker.nextNode())) {
        textNodes.push(node as Text);
      }
    });

    const lowerQuery = q.toLowerCase();
    let matchIndex = 0;

    for (const textNode of textNodes) {
      const text = textNode.textContent || '';
      const lowerText = text.toLowerCase();
      const indices: number[] = [];

      let idx = 0;
      while ((idx = lowerText.indexOf(lowerQuery, idx)) !== -1) {
        indices.push(idx);
        idx += 1;
      }

      if (indices.length === 0) continue;

      const fragment = document.createDocumentFragment();
      let lastEnd = 0;

      for (const start of indices) {
        matchIndex++;
        if (start > lastEnd) {
          fragment.appendChild(document.createTextNode(text.substring(lastEnd, start)));
        }
        const span = document.createElement('span');
        span.className = matchIndex === 1 ? 'find-highlight find-highlight-active' : 'find-highlight';
        span.textContent = text.substring(start, start + q.length);
        span.dataset.matchIndex = String(matchIndex);
        fragment.appendChild(span);
        lastEnd = start + q.length;
      }

      if (lastEnd < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastEnd)));
      }

      textNode.parentNode?.replaceChild(fragment, textNode);
    }

    // Scroll first match into view
    const firstHighlight = document.querySelector('.find-highlight-active');
    firstHighlight?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [note]);

  useEffect(() => {
    highlightMatches(query);
    return () => {
      // Clean up highlights on unmount
      document.querySelectorAll('.find-highlight').forEach(el => {
        const parent = el.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(el.textContent || ''), el);
          parent.normalize();
        }
      });
    };
  }, [query, highlightMatches]);

  const goToMatch = (index: number) => {
    document.querySelectorAll('.find-highlight').forEach(el => {
      el.classList.remove('find-highlight-active');
    });

    const target = document.querySelector(`.find-highlight[data-match-index="${index}"]`);
    if (target) {
      target.classList.add('find-highlight-active');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleNext = () => {
    if (matchCount === 0) return;
    const next = currentMatch >= matchCount ? 1 : currentMatch + 1;
    setCurrentMatch(next);
    goToMatch(next);
  };

  const handlePrev = () => {
    if (matchCount === 0) return;
    const prev = currentMatch <= 1 ? matchCount : currentMatch - 1;
    setCurrentMatch(prev);
    goToMatch(prev);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        handlePrev();
      } else {
        handleNext();
      }
    }
  };

  return (
    <div className="find-bar">
      <div className="find-bar-input-wrapper">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          ref={inputRef}
          type="text"
          className="find-bar-input"
          placeholder="Find in note..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {query && (
          <span className="find-bar-count">
            {matchCount > 0 ? `${currentMatch} of ${matchCount}` : 'No results'}
          </span>
        )}
      </div>
      <button className="find-bar-btn" onClick={handlePrev} disabled={matchCount === 0} title="Previous (Shift+Enter)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="18 15 12 9 6 15"/>
        </svg>
      </button>
      <button className="find-bar-btn" onClick={handleNext} disabled={matchCount === 0} title="Next (Enter)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <button className="find-bar-btn" onClick={onClose} title="Close (Esc)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  );
}
