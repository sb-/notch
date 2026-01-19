import { useState, useCallback, useRef, useEffect } from 'react';
import { useStore, useSelectedNote, useEditorViewMode, useNotebooks } from '../../store';
import CellContainer from './CellContainer';
import NotePreview from '../Preview/NotePreview';
import type { CellType, EditorViewMode } from '../../types';

const cellTypes: { type: CellType; label: string }[] = [
  { type: 'text', label: 'Text Cell' },
  { type: 'code', label: 'Code Cell' },
  { type: 'markdown', label: 'Markdown Cell' },
  { type: 'latex', label: 'LaTeX Cell' },
  { type: 'diagram', label: 'Diagram Cell' },
];

export default function NoteEditor() {
  const note = useSelectedNote();
  const notebooks = useNotebooks();
  const editorViewMode = useEditorViewMode();
  const updateNote = useStore(state => state.updateNote);
  const toggleFavorite = useStore(state => state.toggleFavorite);
  const addCell = useStore(state => state.addCell);
  const deleteCell = useStore(state => state.deleteCell);
  const setEditorViewMode = useStore(state => state.setEditorViewMode);
  const tags = useStore(state => state.tags);
  const addTagToNote = useStore(state => state.addTagToNote);
  const removeTagFromNote = useStore(state => state.removeTagFromNote);
  const createTag = useStore(state => state.createTag);

  const [showCellTypeMenu, setShowCellTypeMenu] = useState(false);
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [showNotebookMenu, setShowNotebookMenu] = useState(false);
  const [focusedCellId, setFocusedCellId] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  // Get the focused cell's type for the toolbar
  const focusedCell = note?.cells.find(c => c.id === focusedCellId);
  const currentCellType = focusedCell?.type || 'text';

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (note) {
        updateNote(note.id, { title: e.target.value });
      }
    },
    [note, updateNote]
  );

  const handleViewModeChange = (mode: EditorViewMode) => {
    setEditorViewMode(mode);
  };

  const handleAddTag = async (tagId: string) => {
    if (note) {
      const tag = tags.find(t => t.id === tagId);
      if (tag && !note.tags.includes(tag.name)) {
        await addTagToNote(note.id, tagId);
      }
    }
    setShowTagMenu(false);
  };

  const handleCreateAndAddTag = async () => {
    if (note && newTagName.trim()) {
      const tag = await createTag(newTagName.trim());
      await addTagToNote(note.id, tag.id);
      setNewTagName('');
      setShowTagMenu(false);
    }
  };

  const handleRemoveTag = async (tagName: string) => {
    if (note) {
      const tag = tags.find(t => t.name === tagName);
      if (tag) {
        await removeTagFromNote(note.id, tag.id);
      }
    }
  };

  const handleMoveToNotebook = async (notebookId: string) => {
    if (note) {
      await updateNote(note.id, { notebookId });
    }
    setShowNotebookMenu(false);
  };

  const handleCellTypeChange = async (type: CellType) => {
    if (note && focusedCellId) {
      const convertCell = useStore.getState().convertCell;
      await convertCell(note.id, focusedCellId, type);
    }
    setShowCellTypeMenu(false);
  };

  const closeAllMenus = () => {
    setShowNotebookMenu(false);
    setShowTagMenu(false);
    setShowCellTypeMenu(false);
  };

  const handleDeleteCell = useCallback(async (cellId: string) => {
    if (!note || note.cells.length <= 1) return; // Don't delete the last cell

    const cellIndex = note.cells.findIndex(c => c.id === cellId);
    await deleteCell(note.id, cellId);

    // Focus previous cell, or next if deleting first cell
    const newFocusIndex = cellIndex > 0 ? cellIndex - 1 : 0;
    const remainingCells = note.cells.filter(c => c.id !== cellId);
    if (remainingCells[newFocusIndex]) {
      setFocusedCellId(remainingCells[newFocusIndex].id);
    }
  }, [note, deleteCell]);

  const handleNavigatePrev = useCallback((cellId: string) => {
    if (!note) return;
    const cellIndex = note.cells.findIndex(c => c.id === cellId);
    if (cellIndex > 0) {
      setFocusedCellId(note.cells[cellIndex - 1].id);
    }
  }, [note]);

  const handleNavigateNext = useCallback((cellId: string) => {
    if (!note) return;
    const cellIndex = note.cells.findIndex(c => c.id === cellId);
    if (cellIndex < note.cells.length - 1) {
      setFocusedCellId(note.cells[cellIndex + 1].id);
    }
  }, [note]);

  // Handle Shift+Enter to add new cell
  const handleKeyDown = useCallback(async (e: React.KeyboardEvent) => {
    if (e.shiftKey && e.key === 'Enter' && note) {
      e.preventDefault();
      const afterCellId = focusedCellId || note.cells[note.cells.length - 1]?.id;
      const newCell = await addCell(note.id, currentCellType, afterCellId);
      setFocusedCellId(newCell.id);
    }
  }, [note, focusedCellId, currentCellType, addCell]);

  // Create default cell if note has no cells, and auto-focus first cell
  useEffect(() => {
    if (note) {
      if (note.cells.length === 0) {
        addCell(note.id, 'text').then(cell => {
          setFocusedCellId(cell.id);
        });
      } else if (!focusedCellId || !note.cells.find(c => c.id === focusedCellId)) {
        // Auto-focus first cell if no cell is focused
        setFocusedCellId(note.cells[0].id);
      }
    }
  }, [note?.id, note?.cells.length, addCell, focusedCellId]);

  if (!note) {
    return (
      <div className="editor">
        <div className="empty-state">
          <div className="empty-state-title">No note selected</div>
        </div>
      </div>
    );
  }

  const currentNotebook = notebooks.find(nb => nb.id === note.notebookId);
  const availableTags = tags.filter(t => !note.tags.includes(t.name));

  const renderEditor = () => (
    <div className="editor-content" ref={contentRef} onKeyDown={handleKeyDown} onClick={closeAllMenus}>
      <div className="cells-container">
        {note.cells.map((cell) => (
          <CellContainer
            key={cell.id}
            noteId={note.id}
            cell={cell}
            isFocused={focusedCellId === cell.id}
            onFocus={() => setFocusedCellId(cell.id)}
            onDelete={() => handleDeleteCell(cell.id)}
            canDelete={note.cells.length > 1}
            onNavigatePrev={() => handleNavigatePrev(cell.id)}
            onNavigateNext={() => handleNavigateNext(cell.id)}
          />
        ))}
      </div>
    </div>
  );

  const renderPreview = () => (
    <div className="editor-content">
      <NotePreview note={note} />
    </div>
  );

  return (
    <div className="editor">
      {/* Note Metadata Header */}
      <div className="editor-header">
        <div className="editor-header-row">
          {/* Notebook selector */}
          <div className="editor-notebook-select" onClick={() => { setShowNotebookMenu(!showNotebookMenu); setShowTagMenu(false); setShowCellTypeMenu(false); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
            <span>{currentNotebook?.name || 'No Notebook'}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
            {showNotebookMenu && (
              <div className="context-menu" onClick={e => e.stopPropagation()}>
                {notebooks
                  .filter((nb, idx, arr) => arr.findIndex(n => n.name === nb.name) === idx)
                  .map(nb => (
                    <div
                      key={nb.id}
                      className={`context-menu-item ${nb.id === note.notebookId ? 'active' : ''}`}
                      onClick={() => handleMoveToNotebook(nb.id)}
                    >
                      {nb.name}
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Tags */}
          <div className="editor-tags" onClick={() => { setShowTagMenu(!showTagMenu); setShowNotebookMenu(false); setShowCellTypeMenu(false); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
              <line x1="7" y1="7" x2="7.01" y2="7"/>
            </svg>
            {note.tags.length > 0 ? (
              note.tags.map(tagName => (
                <span
                  key={tagName}
                  className="editor-tag"
                  onClick={(e) => e.stopPropagation()}
                >
                  #{tagName}
                  <span
                    className="editor-tag-remove"
                    onClick={(e) => { e.stopPropagation(); handleRemoveTag(tagName); }}
                    title="Remove tag"
                  >×</span>
                </span>
              ))
            ) : (
              <span className="editor-tags-placeholder">click to add tags</span>
            )}
            {showTagMenu && (
              <div className="context-menu" onClick={e => e.stopPropagation()}>
                {availableTags.length > 0 && availableTags.map(tag => (
                  <div key={tag.id} className="context-menu-item" onClick={() => handleAddTag(tag.id)}>
                    #{tag.name}
                  </div>
                ))}
                {availableTags.length > 0 && <div className="context-menu-separator" />}
                <div className="context-menu-input">
                  <input
                    type="text"
                    placeholder="New tag..."
                    value={newTagName}
                    onChange={e => setNewTagName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCreateAndAddTag();
                      e.stopPropagation();
                    }}
                    onClick={e => e.stopPropagation()}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Toolbar row with cell type and formatting */}
        <div className="editor-toolbar">
          <div className="editor-toolbar-left">
            <div className="cell-type-dropdown" onClick={() => { setShowCellTypeMenu(!showCellTypeMenu); setShowNotebookMenu(false); setShowTagMenu(false); }}>
              <span>{cellTypes.find(c => c.type === currentCellType)?.label || 'Text Cell'}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
              {showCellTypeMenu && (
                <div className="context-menu" onClick={e => e.stopPropagation()}>
                  {cellTypes.map(({ type, label }) => (
                    <div
                      key={type}
                      className={`context-menu-item ${currentCellType === type ? 'active' : ''}`}
                      onClick={() => handleCellTypeChange(type)}
                    >
                      {label}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Formatting buttons */}
            <div className="editor-format-buttons">
              <button className="format-btn" title="Bold (⌘B)"><strong>B</strong></button>
              <button className="format-btn" title="Italic (⌘I)"><em>I</em></button>
              <button className="format-btn" title="Underline (⌘U)"><span style={{textDecoration:'underline'}}>U</span></button>
              <button className="format-btn" title="Strikethrough"><span style={{textDecoration:'line-through'}}>S</span></button>
              <button className="format-btn" title="Code">{'{}'}</button>
              <button className="format-btn" title="Bullet List">•≡</button>
              <button className="format-btn" title="Numbered List">1≡</button>
              <button className="format-btn" title="Checkbox">☐</button>
              <button className="format-btn" title="Horizontal Rule">—</button>
              <button className="format-btn" title="Heading 1">H1</button>
              <button className="format-btn" title="Heading 2">H2</button>
              <button className="format-btn" title="Heading 3">H3</button>
            </div>
          </div>

          <div className="editor-toolbar-right">
            <button
              className={`editor-view-btn ${editorViewMode === 'editor' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('editor')}
              title="Editor (⌘4)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button
              className={`editor-view-btn ${editorViewMode === 'preview' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('preview')}
              title="Preview (⌘5)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
            <button
              className={`editor-view-btn ${editorViewMode === 'split' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('split')}
              title="Side by Side (⌘6)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <line x1="12" y1="3" x2="12" y2="21"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Title */}
      <div className="editor-title" onClick={closeAllMenus}>
        <input
          type="text"
          className="editor-title-input"
          value={note.title}
          onChange={handleTitleChange}
          placeholder="Untitled"
        />
      </div>

      {/* Content */}
      {editorViewMode === 'editor' && renderEditor()}
      {editorViewMode === 'preview' && renderPreview()}
      {editorViewMode === 'split' && (
        <div className="editor-split">
          <div className="editor-pane">
            {renderEditor()}
          </div>
          <div className="editor-pane">
            {renderPreview()}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="editor-footer">
        <button
          className={`editor-footer-btn ${note.isFavorite ? 'active' : ''}`}
          onClick={() => toggleFavorite(note.id)}
          title={note.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={note.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </button>
        <button className="editor-footer-btn" title="Share">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="18" cy="5" r="3"/>
            <circle cx="6" cy="12" r="3"/>
            <circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
        </button>
        <button className="editor-footer-btn" title="More Options">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="1"/>
            <circle cx="19" cy="12" r="1"/>
            <circle cx="5" cy="12" r="1"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
