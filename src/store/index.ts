import { create } from 'zustand';
import type {
  Notebook,
  Note,
  Cell,
  CellType,
  SpecialCollection,
  EditorViewMode,
  LayoutMode,
  SortBy,
  SortOrder,
  AppState,
  AppActions,
} from '../types';
import * as db from '../services/database';
import { getNotebookSubtreeIds } from '../utils/notebooks';

type Store = AppState & AppActions;

const conversionUndoStack: { noteId: string; cell: Cell }[] = [];
const noteBodyLoadPromises = new Map<string, Promise<void>>();

export const useStore = create<Store>((set, get) => ({
  // Initial UI state
  layoutMode: 'triple',
  editorViewMode: 'split',
  sidebarVisible: true,

  // Initial selection state
  selectedNotebookId: null,
  selectedNoteId: null,
  selectedCollection: 'all',
  selectedTagId: null,

  // Initial data
  notebooks: [],
  notes: [],
  tags: [],

  // Initial search state
  searchQuery: '',
  searchResults: [],

  // Initial sort settings
  sortBy: 'updatedAt',
  sortOrder: 'desc',

  // ==================== LAYOUT ACTIONS ====================

  setLayoutMode: (mode: LayoutMode) => set({ layoutMode: mode }),

  setEditorViewMode: (mode: EditorViewMode) => set({ editorViewMode: mode }),

  toggleSidebar: () => set(state => ({ sidebarVisible: !state.sidebarVisible })),

  // ==================== SELECTION ACTIONS ====================

  selectNotebook: async (id: string | null) => {
    const state = get();
    const notebookIds = id ? getNotebookSubtreeIds(state.notebooks, id) : new Set<string>();
    const notesInNotebook = id
      ? state.notes.filter(n => notebookIds.has(n.notebookId) && !n.isTrashed)
      : [];
    const selectedNoteId = notesInNotebook[0]?.id ?? null;
    set({
      selectedNotebookId: id,
      selectedCollection: null,
      selectedTagId: null,
      selectedNoteId,
    });
    if (selectedNoteId) {
      void get().loadNoteBody(selectedNoteId);
    }
  },

  selectNote: async (id: string | null) => {
    set({ selectedNoteId: id });
    if (id) {
      await get().loadNoteBody(id);
    }
  },

  selectCollection: async (collection: SpecialCollection | null) => {
    const state = get();
    const allNotes = state.notes;
    const notebooks = state.notebooks;

    let filteredNotes: Note[] = [];
    if (collection) {
      switch (collection) {
        case 'all':
          filteredNotes = allNotes.filter(n => !n.isTrashed);
          break;
        case 'favorites':
          filteredNotes = allNotes.filter(n => n.isFavorite && !n.isTrashed);
          break;
        case 'recents':
          filteredNotes = allNotes
            .filter(n => !n.isTrashed)
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 50);
          break;
        case 'trash':
          filteredNotes = allNotes.filter(n => n.isTrashed);
          break;
        case 'inbox':
          const inbox = notebooks.find(nb => nb.name === 'Inbox');
          if (inbox) {
            filteredNotes = allNotes.filter(n => n.notebookId === inbox.id && !n.isTrashed);
          }
          break;
      }
    }

    const selectedNoteId = filteredNotes[0]?.id ?? null;
    set({
      selectedCollection: collection,
      selectedNotebookId: null,
      selectedTagId: null,
      selectedNoteId,
    });
    if (selectedNoteId) {
      void get().loadNoteBody(selectedNoteId);
    }
  },

  selectTag: async (id: string | null) => {
    const state = get();
    const allNotes = state.notes;
    const tag = state.tags.find(t => t.id === id);

    let filteredNotes: Note[] = [];
    if (tag) {
      filteredNotes = allNotes.filter(n => n.tags.includes(tag.name) && !n.isTrashed);
    }

    const selectedNoteId = filteredNotes[0]?.id ?? null;
    set({
      selectedTagId: id,
      selectedNotebookId: null,
      selectedCollection: null,
      selectedNoteId,
    });
    if (selectedNoteId) {
      void get().loadNoteBody(selectedNoteId);
    }
  },

  // ==================== NOTEBOOK ACTIONS ====================

  createNotebook: async (name: string, parentId?: string) => {
    const notebook = await db.createNotebook(name, parentId);
    set(state => ({ notebooks: [...state.notebooks, notebook] }));
    return notebook;
  },

  updateNotebook: async (id: string, updates: Partial<Notebook>) => {
    await db.updateNotebook(id, updates);
    set(state => ({
      notebooks: state.notebooks.map(n =>
        n.id === id ? { ...n, ...updates, updatedAt: Date.now() } : n
      ),
    }));
  },

  deleteNotebook: async (id: string) => {
    await db.deleteNotebook(id);
    set(state => ({
      notebooks: state.notebooks.filter(n => n.id !== id),
      selectedNotebookId: state.selectedNotebookId === id ? null : state.selectedNotebookId,
    }));
  },

  // ==================== NOTE ACTIONS ====================

  createNote: async (notebookId: string, title?: string) => {
    const note = await db.createNote(notebookId, title);
    set(state => ({
      notes: [note, ...state.notes],
      selectedNoteId: note.id,
    }));
    return note;
  },

  updateNote: async (id: string, updates: Partial<Note>) => {
    await db.updateNote(id, updates);
    set(state => ({
      notes: state.notes.map(n =>
        n.id === id ? { ...n, ...updates, updatedAt: updates.updatedAt ?? Date.now() } : n
      ),
    }));
  },

  deleteNote: async (id: string, permanent = false) => {
    await db.deleteNote(id, permanent);
    if (permanent) {
      const state = get();
      const nextSelectedNoteId = state.selectedNoteId === id
        ? state.notes.find(n => n.id !== id)?.id ?? null
        : state.selectedNoteId;
      set({
        notes: state.notes.filter(n => n.id !== id),
        selectedNoteId: nextSelectedNoteId,
      });
      if (nextSelectedNoteId) {
        void get().loadNoteBody(nextSelectedNoteId);
      }
    } else {
      set(state => ({
        notes: state.notes.map(n =>
          n.id === id ? { ...n, isTrashed: true } : n
        ),
      }));
    }
  },

  restoreNote: async (id: string) => {
    await db.restoreNote(id);
    set(state => ({
      notes: state.notes.map(n =>
        n.id === id ? { ...n, isTrashed: false } : n
      ),
    }));
  },

  toggleFavorite: async (id: string) => {
    await db.toggleNoteFavorite(id);
    set(state => ({
      notes: state.notes.map(n =>
        n.id === id ? { ...n, isFavorite: !n.isFavorite } : n
      ),
    }));
  },

  // ==================== CELL ACTIONS ====================

  addCell: async (noteId: string, type: CellType, afterCellId?: string) => {
    const cell = await db.createCell(noteId, type, afterCellId);
    set(state => ({
      notes: state.notes.map(n => {
        if (n.id !== noteId) return n;

        const cells = [...n.cells];
        if (afterCellId) {
          const afterIndex = cells.findIndex(c => c.id === afterCellId);
          cells.splice(afterIndex + 1, 0, cell);
        } else {
          cells.push(cell);
        }

        // Re-index sort orders
        cells.forEach((c, i) => (c.sortOrder = i));

        return { ...n, cells };
      }),
    }));
    return cell;
  },

  updateCell: async (noteId: string, cellId: string, updates: Partial<Cell>) => {
    // Update store first so the UI reflects changes immediately (preserves cursor position)
    set(state => ({
      notes: state.notes.map(n => {
        if (n.id !== noteId) return n;
        return {
          ...n,
          cells: n.cells.map(c =>
            c.id === cellId ? { ...c, ...updates } : c
          ),
          updatedAt: Date.now(),
        };
      }),
    }));
    await db.updateCell(noteId, cellId, updates);
  },

  deleteCell: async (noteId: string, cellId: string) => {
    await db.deleteCell(noteId, cellId);
    set(state => ({
      notes: state.notes.map(n => {
        if (n.id !== noteId) return n;
        const cells = n.cells.filter(c => c.id !== cellId);
        cells.forEach((c, i) => (c.sortOrder = i));
        return { ...n, cells, updatedAt: Date.now() };
      }),
    }));
  },

  moveCell: async (noteId: string, cellId: string, newIndex: number) => {
    await db.moveCell(noteId, cellId, newIndex);
    set(state => ({
      notes: state.notes.map(n => {
        if (n.id !== noteId) return n;

        const cells = [...n.cells];
        const currentIndex = cells.findIndex(c => c.id === cellId);
        if (currentIndex === -1) return n;

        const [cell] = cells.splice(currentIndex, 1);
        cells.splice(newIndex, 0, cell);
        cells.forEach((c, i) => (c.sortOrder = i));

        return { ...n, cells, updatedAt: Date.now() };
      }),
    }));
  },

  convertCell: async (noteId: string, cellId: string, newType: CellType) => {
    const previousCell = get()
      .notes.find(n => n.id === noteId)
      ?.cells.find(c => c.id === cellId);

    const convertedCell = await db.convertCell(noteId, cellId, newType);
    if (!convertedCell) return;

    if (previousCell && previousCell.type !== newType) {
      conversionUndoStack.push({ noteId, cell: { ...previousCell } });
    }

    set(state => ({
      notes: state.notes.map(n => {
        if (n.id !== noteId) return n;
        return {
          ...n,
          cells: n.cells.map(c => c.id === cellId ? convertedCell : c),
          updatedAt: Date.now(),
        };
      }),
    }));
  },

  undoLastCellConversion: async () => {
    const undo = conversionUndoStack.pop();
    if (!undo) return false;

    await db.updateCell(undo.noteId, undo.cell.id, {
      type: undo.cell.type,
      data: undo.cell.data,
      language: undo.cell.language,
      diagramType: undo.cell.diagramType,
    });

    set(state => ({
      notes: state.notes.map(n => {
        if (n.id !== undo.noteId) return n;
        return {
          ...n,
          cells: n.cells.map(c => c.id === undo.cell.id ? { ...undo.cell } : c),
          updatedAt: Date.now(),
        };
      }),
    }));

    return true;
  },

  // ==================== TAG ACTIONS ====================

  createTag: async (name: string) => {
    const tag = await db.createTag(name);
    set(state => ({ tags: [...state.tags, tag] }));
    return tag;
  },

  deleteTag: async (id: string) => {
    await db.deleteTag(id);
    set(state => ({
      tags: state.tags.filter(t => t.id !== id),
      selectedTagId: state.selectedTagId === id ? null : state.selectedTagId,
    }));
  },

  addTagToNote: async (noteId: string, tagId: string) => {
    await db.addTagToNote(noteId, tagId);
    const tag = get().tags.find(t => t.id === tagId);
    if (tag) {
      set(state => ({
        notes: state.notes.map(n =>
          n.id === noteId ? { ...n, tags: [...n.tags, tag.name] } : n
        ),
      }));
    }
  },

  removeTagFromNote: async (noteId: string, tagId: string) => {
    await db.removeTagFromNote(noteId, tagId);
    const tag = get().tags.find(t => t.id === tagId);
    if (tag) {
      set(state => ({
        notes: state.notes.map(n =>
          n.id === noteId ? { ...n, tags: n.tags.filter(t => t !== tag.name) } : n
        ),
      }));
    }
  },

  // ==================== SEARCH ACTIONS ====================

  setSearchQuery: (query: string) => set({ searchQuery: query }),

  search: async (query: string) => {
    if (!query.trim()) {
      set({ searchQuery: '', searchResults: [] });
      return;
    }
    const results = await db.searchNotes(query);
    set({ searchQuery: query, searchResults: results });
  },

  // ==================== SORT ACTIONS ====================

  setSortBy: (sortBy: SortBy) => set({ sortBy }),

  setSortOrder: (order: SortOrder) => set({ sortOrder: order }),

  // ==================== DATA LOADING ====================

  loadData: async (databasePath?: string) => {
    conversionUndoStack.length = 0;
    noteBodyLoadPromises.clear();
    await db.initDatabase(databasePath);
    await db.ensureInboxNotebook();

    const [tags, notes, notebooks] = await Promise.all([
      db.getAllTags(),
      db.getAllNoteSummaries(),
      db.getAllNotebooks(),
    ]);
    const selectedNoteId = notes[0]?.id ?? null;

    set({
      notebooks,
      tags,
      notes,
      selectedNotebookId: null,
      selectedCollection: 'all',
      selectedTagId: null,
      selectedNoteId,
    });

    if (selectedNoteId) {
      void get().loadNoteBody(selectedNoteId);
    }
  },

  loadNoteBody: async (id: string) => {
    const existingNote = get().notes.find(note => note.id === id);
    if (!existingNote || existingNote.bodyLoaded) return;

    const inFlight = noteBodyLoadPromises.get(id);
    if (inFlight) return inFlight;

    const loadPromise = db.getNote(id)
      .then(note => {
        if (!note) return;
        set(state => ({
          notes: state.notes.map(existing =>
            existing.id === id ? { ...existing, ...note, bodyLoaded: true } : existing
          ),
        }));
      })
      .finally(() => {
        noteBodyLoadPromises.delete(id);
      });

    noteBodyLoadPromises.set(id, loadPromise);
    return loadPromise;
  },
}));

// Selector hooks for common state slices
export const useNotebooks = () => useStore(state => state.notebooks);
export const useNotes = () => useStore(state => state.notes);
export const useTags = () => useStore(state => state.tags);
export const useSelectedNote = () => {
  const notes = useStore(state => state.notes);
  const selectedNoteId = useStore(state => state.selectedNoteId);
  return notes.find(n => n.id === selectedNoteId) ?? null;
};
export const useLayoutMode = () => useStore(state => state.layoutMode);
export const useEditorViewMode = () => useStore(state => state.editorViewMode);
export const useSidebarVisible = () => useStore(state => state.sidebarVisible);
