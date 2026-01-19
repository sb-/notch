import { useState, useEffect } from 'react';
import { useStore, useNotebooks, useTags } from '../../store';
import type { SpecialCollection } from '../../types';

interface NoteCounts {
  inbox: number;
  favorites: number;
  recents: number;
  trash: number;
  all: number;
  notebooks: Record<string, number>;
}

// SVG icons for library items
const icons = {
  inbox: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>,
  favorites: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  recents: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  trash: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
  all: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
};

const libraryItems: { id: SpecialCollection; name: string }[] = [
  { id: 'inbox', name: 'Inbox' },
  { id: 'favorites', name: 'Favorites' },
  { id: 'recents', name: 'Recents' },
  { id: 'trash', name: 'Trash' },
  { id: 'all', name: 'All Notes' },
];

export default function Sidebar() {
  const [activeTab, setActiveTab] = useState<'notebooks' | 'tags'>('notebooks');
  const [newItemName, setNewItemName] = useState('');
  const [showNewInput, setShowNewInput] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; notebookId: string } | null>(null);

  const notebooks = useNotebooks();
  const tags = useTags();
  const notes = useStore(state => state.notes);
  const selectedCollection = useStore(state => state.selectedCollection);
  const selectedNotebookId = useStore(state => state.selectedNotebookId);
  const selectedTagId = useStore(state => state.selectedTagId);
  const selectCollection = useStore(state => state.selectCollection);
  const selectNotebook = useStore(state => state.selectNotebook);
  const selectTag = useStore(state => state.selectTag);
  const createNotebook = useStore(state => state.createNotebook);
  const createTag = useStore(state => state.createTag);
  const deleteNotebook = useStore(state => state.deleteNotebook);
  const createNote = useStore(state => state.createNote);

  // Calculate note counts
  const counts: NoteCounts = {
    inbox: notes.filter(n => {
      const inboxNotebook = notebooks.find(nb => nb.name === 'Inbox');
      return inboxNotebook && n.notebookId === inboxNotebook.id && !n.isTrashed;
    }).length,
    favorites: notes.filter(n => n.isFavorite && !n.isTrashed).length,
    recents: Math.min(notes.filter(n => !n.isTrashed).length, 50),
    trash: notes.filter(n => n.isTrashed).length,
    all: notes.filter(n => !n.isTrashed).length,
    notebooks: notebooks.reduce((acc, nb) => {
      acc[nb.id] = notes.filter(n => n.notebookId === nb.id && !n.isTrashed).length;
      return acc;
    }, {} as Record<string, number>),
  };

  // Filter notebooks
  const filteredNotebooks = notebooks.filter(nb =>
    nb.name !== 'Inbox' &&
    nb.name.toLowerCase().includes(filterText.toLowerCase())
  );

  // Filter tags
  const filteredTags = tags.filter(tag =>
    tag.name.toLowerCase().includes(filterText.toLowerCase())
  );

  const handleCreateItem = async () => {
    if (newItemName.trim()) {
      if (activeTab === 'notebooks') {
        await createNotebook(newItemName.trim());
      } else {
        await createTag(newItemName.trim());
      }
      setNewItemName('');
      setShowNewInput(false);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, notebookId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, notebookId });
  };

  const handleNewNoteInNotebook = async () => {
    if (contextMenu) {
      await createNote(contextMenu.notebookId);
      setContextMenu(null);
    }
  };

  const handleDeleteNotebook = async () => {
    if (contextMenu && confirm('Delete this notebook and all its notes?')) {
      await deleteNotebook(contextMenu.notebookId);
      setContextMenu(null);
    }
  };

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      window.addEventListener('click', handleClick);
      return () => window.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

  return (
    <div className="sidebar">
      {/* Tab Toggle */}
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${activeTab === 'notebooks' ? 'active' : ''}`}
          onClick={() => setActiveTab('notebooks')}
        >
          Notebooks
        </button>
        <button
          className={`sidebar-tab ${activeTab === 'tags' ? 'active' : ''}`}
          onClick={() => setActiveTab('tags')}
        >
          Tags
        </button>
      </div>

      {activeTab === 'notebooks' ? (
        <>
          {/* Library Section */}
          <div className="sidebar-section">
            <div className="sidebar-section-header">Library</div>
            {libraryItems.map(item => (
              <div
                key={item.id}
                className={`sidebar-item ${selectedCollection === item.id ? 'selected' : ''}`}
                onClick={() => selectCollection(item.id)}
              >
                <span className="sidebar-item-icon">{icons[item.id]}</span>
                <span className="sidebar-item-name">{item.name}</span>
                <span className="sidebar-item-count">{counts[item.id]}</span>
              </div>
            ))}
          </div>

          {/* Notebooks Section */}
          <div className="sidebar-section">
            <div className="sidebar-section-header">Notebooks</div>
          </div>
          <div className="notebooks-list">
            {filteredNotebooks.map(notebook => (
              <div
                key={notebook.id}
                className={`sidebar-item ${selectedNotebookId === notebook.id ? 'selected' : ''}`}
                onClick={() => selectNotebook(notebook.id)}
                onContextMenu={(e) => handleContextMenu(e, notebook.id)}
              >
                <span className="sidebar-item-name">{notebook.name}</span>
                <span className="sidebar-item-count">{counts.notebooks[notebook.id] || 0}</span>
              </div>
            ))}
            {showNewInput && (
              <input
                className="inline-input"
                type="text"
                value={newItemName}
                onChange={e => setNewItemName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreateItem();
                  if (e.key === 'Escape') {
                    setShowNewInput(false);
                    setNewItemName('');
                  }
                }}
                onBlur={() => {
                  if (!newItemName.trim()) {
                    setShowNewInput(false);
                  }
                }}
                placeholder="Notebook name..."
                autoFocus
              />
            )}
          </div>
        </>
      ) : (
        /* Tags View */
        <div className="tags-view" style={{ flex: 1, overflowY: 'auto' }}>
          {filteredTags.map(tag => (
            <div
              key={tag.id}
              className={`tag-item ${selectedTagId === tag.id ? 'selected' : ''}`}
              onClick={() => selectTag(tag.id)}
            >
              {tag.name}
            </div>
          ))}
          {showNewInput && (
            <input
              className="inline-input"
              type="text"
              value={newItemName}
              onChange={e => setNewItemName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreateItem();
                if (e.key === 'Escape') {
                  setShowNewInput(false);
                  setNewItemName('');
                }
              }}
              onBlur={() => {
                if (!newItemName.trim()) {
                  setShowNewInput(false);
                }
              }}
              placeholder="Tag name..."
              autoFocus
            />
          )}
        </div>
      )}

      {/* Footer */}
      <div className="sidebar-footer">
        <button
          className="sidebar-add-btn"
          onClick={() => setShowNewInput(true)}
          title={activeTab === 'notebooks' ? 'New Notebook' : 'New Tag'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
        <div className="sidebar-search">
          <span className="sidebar-search-icon">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </span>
          <input
            type="text"
            placeholder="Filter by keyword, title or #tag"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
          />
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          <div className="context-menu-item" onClick={handleNewNoteInNotebook}>
            New Note
          </div>
          <div className="context-menu-separator" />
          <div className="context-menu-item" onClick={handleDeleteNotebook}>
            Delete Notebook
          </div>
        </div>
      )}
    </div>
  );
}
