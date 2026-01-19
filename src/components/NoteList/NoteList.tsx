import { useMemo, useState } from 'react';
import { useStore, useNotes, useNotebooks } from '../../store';
import NoteListItem from './NoteListItem';
import type { SortBy } from '../../types';

function getTitle(
  collection: string | null,
  notebookId: string | null,
  tagId: string | null,
  notebooks: { id: string; name: string }[],
  tags: { id: string; name: string }[]
): string {
  if (notebookId) {
    return notebooks.find(n => n.id === notebookId)?.name || 'Notebook';
  }
  if (tagId) {
    const tag = tags.find(t => t.id === tagId);
    return tag ? `#${tag.name}` : 'Tag';
  }
  if (collection) {
    switch (collection) {
      case 'inbox': return 'Inbox';
      case 'favorites': return 'Favorites';
      case 'recents': return 'Recents';
      case 'all': return 'All Notes';
      case 'trash': return 'Trash';
    }
  }
  return 'Notes';
}

const sortOptions: { value: SortBy; label: string }[] = [
  { value: 'updatedAt', label: 'Updated' },
  { value: 'createdAt', label: 'Created' },
  { value: 'title', label: 'Title' },
];

export default function NoteList() {
  const [showSortMenu, setShowSortMenu] = useState(false);

  const notes = useNotes();
  const notebooks = useNotebooks();
  const tags = useStore(state => state.tags);
  const selectedNoteId = useStore(state => state.selectedNoteId);
  const selectedCollection = useStore(state => state.selectedCollection);
  const selectedNotebookId = useStore(state => state.selectedNotebookId);
  const selectedTagId = useStore(state => state.selectedTagId);
  const selectNote = useStore(state => state.selectNote);
  const createNote = useStore(state => state.createNote);
  const sortBy = useStore(state => state.sortBy);
  const sortOrder = useStore(state => state.sortOrder);
  const setSortBy = useStore(state => state.setSortBy);

  const title = getTitle(selectedCollection, selectedNotebookId, selectedTagId, notebooks, tags);

  // Filter and sort notes
  const displayNotes = useMemo(() => {
    let filtered = notes;

    // Filter based on selection
    if (selectedCollection === 'trash') {
      filtered = notes.filter(n => n.isTrashed);
    } else {
      filtered = notes.filter(n => !n.isTrashed);
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'title':
          cmp = a.title.localeCompare(b.title);
          break;
        case 'createdAt':
          cmp = (b.createdAt || 0) - (a.createdAt || 0);
          break;
        case 'updatedAt':
        default:
          cmp = (b.updatedAt || 0) - (a.updatedAt || 0);
          break;
      }
      const result = sortOrder === 'desc' ? cmp : -cmp;
      // Stable sort by id when timestamps are equal
      return result !== 0 ? result : a.id.localeCompare(b.id);
    });

    return sorted;
  }, [notes, selectedCollection, sortBy, sortOrder]);

  const handleCreateNote = async () => {
    let notebookId = selectedNotebookId;
    if (!notebookId) {
      const inbox = notebooks.find(n => n.name === 'Inbox');
      notebookId = inbox?.id || notebooks[0]?.id;
    }
    if (notebookId) {
      await createNote(notebookId);
    }
  };

  const handleSortChange = (newSortBy: SortBy) => {
    setSortBy(newSortBy);
    setShowSortMenu(false);
  };

  const currentSortLabel = sortOptions.find(o => o.value === sortBy)?.label || 'Updated';

  return (
    <div className="note-list">
      {/* Header */}
      <div className="note-list-header">
        <button className="note-list-add-btn" onClick={handleCreateNote} title="New Note">
          +
        </button>
        <div className="note-list-notebook">
          {title}
        </div>
      </div>

      {/* Sort */}
      <div
        className="note-list-sort"
        onClick={() => setShowSortMenu(!showSortMenu)}
        style={{ position: 'relative' }}
      >
        Sort by {currentSortLabel} ↓
        {showSortMenu && (
          <div
            className="context-menu"
            style={{ top: '100%', left: 0, marginTop: 4 }}
            onClick={e => e.stopPropagation()}
          >
            {sortOptions.map(option => (
              <div
                key={option.value}
                className={`context-menu-item ${sortBy === option.value ? 'active' : ''}`}
                onClick={() => handleSortChange(option.value)}
                style={sortBy === option.value ? { background: 'var(--bg-selected)', color: 'white' } : {}}
              >
                {option.label}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Note Items */}
      <div className="note-list-items">
        {displayNotes.length === 0 ? (
          <div className="empty-state" style={{ padding: 20 }}>
            <div className="empty-state-title">No notes</div>
          </div>
        ) : (
          displayNotes.map(note => (
            <NoteListItem
              key={note.id}
              note={note}
              isSelected={selectedNoteId === note.id}
              onClick={() => selectNote(note.id)}
            />
          ))
        )}
      </div>

    </div>
  );
}
