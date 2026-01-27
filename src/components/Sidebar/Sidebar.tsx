import { useState, useEffect } from 'react';
import { useStore, useNotebooks, useTags } from '../../store';
import type { Notebook, SpecialCollection } from '../../types';

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

// Build a tree structure from flat notebook list
interface NotebookNode extends Notebook {
  children: NotebookNode[];
}

function buildNotebookTree(notebooks: Notebook[]): NotebookNode[] {
  const map = new Map<string, NotebookNode>();
  const roots: NotebookNode[] = [];

  // Create nodes
  for (const notebook of notebooks) {
    map.set(notebook.id, { ...notebook, children: [] });
  }

  // Build tree
  for (const notebook of notebooks) {
    const node = map.get(notebook.id)!;
    if (notebook.parentId && map.has(notebook.parentId)) {
      map.get(notebook.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort children by sortOrder, then name
  const sortNodes = (nodes: NotebookNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    for (const node of nodes) {
      sortNodes(node.children);
    }
  };
  sortNodes(roots);

  return roots;
}

// Chevron icon for expandable notebooks
const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    style={{
      transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: 'transform 0.15s ease',
    }}
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

// Recursive component for rendering nested notebooks
interface NotebookTreeItemProps {
  node: NotebookNode;
  depth: number;
  selectedNotebookId: string | null;
  counts: Record<string, number>;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  // For inline input
  newNotebookParentId: string | null;
  showNewInput: boolean;
  newItemName: string;
  onNewItemNameChange: (name: string) => void;
  onCreateItem: () => void;
  onCancelCreate: () => void;
}

function NotebookTreeItem({
  node,
  depth,
  selectedNotebookId,
  counts,
  expandedIds,
  onToggleExpand,
  onSelect,
  onContextMenu,
  newNotebookParentId,
  showNewInput,
  newItemName,
  onNewItemNameChange,
  onCreateItem,
  onCancelCreate,
}: NotebookTreeItemProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedNotebookId === node.id;
  const showInputHere = showNewInput && newNotebookParentId === node.id;

  return (
    <>
      <div
        className={`sidebar-item ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => onSelect(node.id)}
        onContextMenu={(e) => onContextMenu(e, node.id)}
      >
        {hasChildren || showInputHere ? (
          <span
            className="notebook-expand-btn"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
          >
            <ChevronIcon expanded={isExpanded || showInputHere} />
          </span>
        ) : (
          <span className="notebook-expand-placeholder" />
        )}
        <span className="sidebar-item-name">{node.name}</span>
        <span className="sidebar-item-count">{counts[node.id] || 0}</span>
      </div>
      {(hasChildren && isExpanded) || showInputHere ? (
        <div className="notebook-children">
          {node.children.map((child) => (
            <NotebookTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedNotebookId={selectedNotebookId}
              counts={counts}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              newNotebookParentId={newNotebookParentId}
              showNewInput={showNewInput}
              newItemName={newItemName}
              onNewItemNameChange={onNewItemNameChange}
              onCreateItem={onCreateItem}
              onCancelCreate={onCancelCreate}
            />
          ))}
          {showInputHere && (
            <input
              className="inline-input"
              style={{ marginLeft: `${8 + (depth + 1) * 16}px`, width: `calc(100% - ${16 + (depth + 1) * 16}px)` }}
              type="text"
              value={newItemName}
              onChange={e => onNewItemNameChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') onCreateItem();
                if (e.key === 'Escape') onCancelCreate();
              }}
              onBlur={() => {
                if (!newItemName.trim()) onCancelCreate();
              }}
              placeholder="Notebook name..."
              autoFocus
            />
          )}
        </div>
      ) : null}
    </>
  );
}

export default function Sidebar() {
  const [activeTab, setActiveTab] = useState<'notebooks' | 'tags'>('notebooks');
  const [newItemName, setNewItemName] = useState('');
  const [showNewInput, setShowNewInput] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; notebookId: string } | null>(null);
  const [expandedNotebooks, setExpandedNotebooks] = useState<Set<string>>(new Set());
  const [newNotebookParentId, setNewNotebookParentId] = useState<string | null>(null);

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

  // Filter tags
  const filteredTags = tags.filter(tag =>
    tag.name.toLowerCase().includes(filterText.toLowerCase())
  );

  const handleCreateItem = async () => {
    if (newItemName.trim()) {
      if (activeTab === 'notebooks') {
        await createNotebook(newItemName.trim(), newNotebookParentId ?? undefined);
        if (newNotebookParentId) {
          setExpandedNotebooks(prev => new Set([...prev, newNotebookParentId]));
        }
      } else {
        await createTag(newItemName.trim());
      }
      setNewItemName('');
      setShowNewInput(false);
      setNewNotebookParentId(null);
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

  const handleCreateSubNotebook = () => {
    if (contextMenu) {
      setNewNotebookParentId(contextMenu.notebookId);
      setShowNewInput(true);
      setContextMenu(null);
    }
  };

  const toggleNotebookExpanded = (id: string) => {
    setExpandedNotebooks(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Build notebook tree for hierarchical display
  const notebookTree = buildNotebookTree(
    notebooks.filter(nb => nb.name !== 'Inbox' && nb.name.toLowerCase().includes(filterText.toLowerCase()))
  );

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
            {notebookTree.map(node => (
              <NotebookTreeItem
                key={node.id}
                node={node}
                depth={0}
                selectedNotebookId={selectedNotebookId}
                counts={counts.notebooks}
                expandedIds={expandedNotebooks}
                onToggleExpand={toggleNotebookExpanded}
                onSelect={selectNotebook}
                onContextMenu={handleContextMenu}
                newNotebookParentId={newNotebookParentId}
                showNewInput={showNewInput}
                newItemName={newItemName}
                onNewItemNameChange={setNewItemName}
                onCreateItem={handleCreateItem}
                onCancelCreate={() => {
                  setShowNewInput(false);
                  setNewItemName('');
                  setNewNotebookParentId(null);
                }}
              />
            ))}
            {showNewInput && !newNotebookParentId && (
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
          onClick={() => {
            setNewNotebookParentId(null);
            setShowNewInput(true);
          }}
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
          <div className="context-menu-item" onClick={handleCreateSubNotebook}>
            New Notebook
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
