// Cell types supported by Notch
export type CellType = 'text' | 'code' | 'markdown' | 'latex' | 'diagram';

// Diagram types for diagram cells
export type DiagramType = 'sequence' | 'flow';

// Cell represents a single content block within a note
export interface Cell {
  id: string;
  type: CellType;
  data: string;
  language?: string; // For code cells (e.g., 'javascript', 'python')
  diagramType?: DiagramType; // For diagram cells
  sortOrder: number;
}

// Note represents a document containing multiple cells
export interface Note {
  id: string;
  notebookId: string;
  title: string;
  cells: Cell[];
  tags: string[];
  isFavorite: boolean;
  isTrashed: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

// Notebook is a container for notes
export interface Notebook {
  id: string;
  name: string;
  parentId?: string; // For nested notebooks
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

// Tag for categorizing notes
export interface Tag {
  id: string;
  name: string;
}

// Resource represents an embedded file (image, attachment)
export interface Resource {
  id: string;
  noteId: string;
  filename: string;
  mimeType?: string;
  data: Uint8Array;
}

// Special collection types for the sidebar
export type SpecialCollection = 'inbox' | 'favorites' | 'recents' | 'all' | 'trash';

// View mode for the editor
export type EditorViewMode = 'editor' | 'preview' | 'split';

// Layout mode for the app
export type LayoutMode = 'single' | 'double' | 'triple';

// Sort options for note list
export type SortBy = 'title' | 'createdAt' | 'updatedAt' | 'manual';
export type SortOrder = 'asc' | 'desc';

// Application state types
export interface AppState {
  // UI state
  layoutMode: LayoutMode;
  editorViewMode: EditorViewMode;
  sidebarVisible: boolean;

  // Selection state
  selectedNotebookId: string | null;
  selectedNoteId: string | null;
  selectedCollection: SpecialCollection | null;
  selectedTagId: string | null;

  // Data
  notebooks: Notebook[];
  notes: Note[];
  tags: Tag[];

  // Search
  searchQuery: string;
  searchResults: Note[];

  // Sort settings
  sortBy: SortBy;
  sortOrder: SortOrder;
}

// Actions for state management
export interface AppActions {
  // Layout actions
  setLayoutMode: (mode: LayoutMode) => void;
  setEditorViewMode: (mode: EditorViewMode) => void;
  toggleSidebar: () => void;

  // Selection actions
  selectNotebook: (id: string | null) => void;
  selectNote: (id: string | null) => void;
  selectCollection: (collection: SpecialCollection | null) => void;
  selectTag: (id: string | null) => void;

  // Notebook actions
  createNotebook: (name: string, parentId?: string) => Promise<Notebook>;
  updateNotebook: (id: string, updates: Partial<Notebook>) => Promise<void>;
  deleteNotebook: (id: string) => Promise<void>;

  // Note actions
  createNote: (notebookId: string, title?: string) => Promise<Note>;
  updateNote: (id: string, updates: Partial<Note>) => Promise<void>;
  deleteNote: (id: string, permanent?: boolean) => Promise<void>;
  restoreNote: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;

  // Cell actions
  addCell: (noteId: string, type: CellType, afterCellId?: string) => Promise<Cell>;
  updateCell: (noteId: string, cellId: string, updates: Partial<Cell>) => Promise<void>;
  deleteCell: (noteId: string, cellId: string) => Promise<void>;
  moveCell: (noteId: string, cellId: string, newIndex: number) => Promise<void>;
  convertCell: (noteId: string, cellId: string, newType: CellType) => Promise<void>;

  // Tag actions
  createTag: (name: string) => Promise<Tag>;
  deleteTag: (id: string) => Promise<void>;
  addTagToNote: (noteId: string, tagId: string) => Promise<void>;
  removeTagFromNote: (noteId: string, tagId: string) => Promise<void>;

  // Search actions
  setSearchQuery: (query: string) => void;
  search: (query: string) => Promise<void>;

  // Sort actions
  setSortBy: (sortBy: SortBy) => void;
  setSortOrder: (order: SortOrder) => void;

  // Data loading
  loadData: () => Promise<void>;
}

// Database row types (matching SQLite schema)
export interface NotebookRow {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface NoteRow {
  id: string;
  notebook_id: string;
  title: string;
  is_favorite: number; // SQLite boolean
  is_trashed: number; // SQLite boolean
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface CellRow {
  id: string;
  note_id: string;
  type: CellType;
  data: string;
  language: string | null;
  diagram_type: DiagramType | null;
  sort_order: number;
}

export interface TagRow {
  id: string;
  name: string;
}

export interface NoteTagRow {
  note_id: string;
  tag_id: string;
}

export interface ResourceRow {
  id: string;
  note_id: string;
  filename: string;
  mime_type: string | null;
  data: Uint8Array;
}

// Quiver import types (for .qvlibrary parsing)
export interface QuiverNotebook {
  name: string;
  uuid: string;
}

export interface QuiverNote {
  title: string;
  uuid: string;
  created_at: number;
  updated_at: number;
  tags: string[];
}

export interface QuiverCell {
  type: 'text' | 'code' | 'markdown' | 'latex' | 'diagram';
  language?: string;
  diagramType?: string;
  data: string;
}
