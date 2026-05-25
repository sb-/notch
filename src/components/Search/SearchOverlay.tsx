import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../../store';
import { searchNotes } from '../../services/search';
import type { Note } from '../../types';

interface SearchOverlayProps {
  onClose: () => void;
}

export default function SearchOverlay({ onClose }: SearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Note[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const notebooks = useStore(state => state.notebooks);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSearch = useCallback(async (q: string) => {
    setQuery(q);
    if (!q.trim()) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }
    const notes = await searchNotes(q);
    setResults(notes);
    setSelectedIndex(0);
  }, []);

  const navigateToNote = useCallback((note: Note) => {
    const state = useStore.getState();
    state.selectNotebook(note.notebookId);
    state.selectNote(note.id);
    onClose();
  }, [onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      navigateToNote(results[selectedIndex]);
    }
  };

  const getNotebookName = (notebookId: string) => {
    return notebooks.find(n => n.id === notebookId)?.name || '';
  };

  const getPreview = (note: Note) => {
    const text = note.cells.map(c => c.data).join(' ').replace(/<[^>]+>/g, '');
    return text.substring(0, 120);
  };

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-modal" onClick={e => e.stopPropagation()}>
        <div className="search-input-wrapper">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Search all notes..."
            value={query}
            onChange={e => handleSearch(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className="search-kbd">esc</kbd>
        </div>
        {results.length > 0 && (
          <div className="search-results">
            {results.map((note, index) => (
              <div
                key={note.id}
                className={`search-result-item ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => navigateToNote(note)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className="search-result-title">{note.title}</div>
                <div className="search-result-meta">
                  <span className="search-result-notebook">{getNotebookName(note.notebookId)}</span>
                  <span className="search-result-preview">{getPreview(note)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {query.trim() && results.length === 0 && (
          <div className="search-no-results">No results found</div>
        )}
      </div>
    </div>
  );
}
