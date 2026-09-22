import { v4 as uuid } from 'uuid';
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
import { validSelectedNote, visibleNotes } from '../utils/noteSelection';
import { preferencesChanged, readPreferences, savePreferences } from './preferences';

type Store = AppState & AppActions;

const conversionUndoStack: { noteId: string; cell: Cell }[] = [];
// Per-note insertion barriers keep rapid insertions and edits ordered on disk.
const pendingCellInsertions = new Map<string, Promise<unknown>>();
const noteBodyLoadPromises = new Map<string, Promise<void>>();
let currentLibraryPath: string | null = null;

export const useStore = create<Store>((set, get) => ({
  // Initial UI state
  layoutMode: 'triple',
  editorViewMode: 'split',
  sidebarVisible: true,
  assistantVisible: false,
  settingsOpen: false,
  assistantSettingsVersion: 0,

  // Initial selection state
  selectedNotebookId: null,
  selectedNoteId: null,
  selectedCollection: 'all',
  selectedTagId: null,
  focusedCellId: null,

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

  toggleAssistant: () => set(state => ({ assistantVisible: !state.assistantVisible })),

  setAssistantVisible: (visible: boolean) => set({ assistantVisible: visible }),

  setSettingsOpen: (open: boolean) => set({ settingsOpen: open }),

  bumpAssistantSettings: () => set(state => ({ assistantSettingsVersion: state.assistantSettingsVersion + 1 })),

  setFocusedCellId: (id: string | null) => set({ focusedCellId: id }),

  // ==================== SELECTION ACTIONS ====================

  selectNotebook: async (id: string | null) => {
    const state = get();
    const selectedNoteId = id ? visibleNotes({ ...state, selectedNotebookId: id,
      selectedCollection: null, selectedTagId: null })[0]?.id ?? null : null;
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
    const selectedNoteId = collection ? visibleNotes({ ...state, selectedCollection: collection,
      selectedNotebookId: null, selectedTagId: null })[0]?.id ?? null : null;
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
    const selectedNoteId = id ? visibleNotes({ ...state, selectedTagId: id,
      selectedNotebookId: null, selectedCollection: null })[0]?.id ?? null : null;
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
    const removedIds = getNotebookSubtreeIds(get().notebooks, id);
    await db.deleteNotebook(id);
    const notebooks = await db.getAllNotebooks();
    const inbox = notebooks.find(notebook => notebook.name === 'Inbox' && !notebook.parentId)!;
    const state = get();
    const next = {
      ...state, notebooks,
      notes: state.notes.map(note => removedIds.has(note.notebookId)
        ? { ...note, notebookId: inbox.id, isTrashed: true } : note),
      selectedNotebookId: state.selectedNotebookId && removedIds.has(state.selectedNotebookId) ? null : state.selectedNotebookId,
    };
    if (state.selectedNotebookId && removedIds.has(state.selectedNotebookId)) next.selectedCollection = 'trash';
    const selectedNoteId = validSelectedNote(next);
    set({ notebooks, notes: next.notes, selectedNotebookId: next.selectedNotebookId, selectedCollection: next.selectedCollection,
      selectedNoteId, focusedCellId: null, searchResults: [] });
    if (selectedNoteId) void get().loadNoteBody(selectedNoteId);
  },

  // ==================== NOTE ACTIONS ====================

  createNote: async (notebookId: string, title?: string) => {
    const note = await db.createNote(notebookId, title);
    const state = get();
    const next = { ...state, notes: [note, ...state.notes], selectedNoteId: note.id };
    // A new note must be visible even when created from Trash or a tag filter.
    const destination = validSelectedNote(next) === note.id ? {} : {
      selectedNotebookId: notebookId, selectedCollection: null, selectedTagId: null,
    };
    set({ notes: next.notes, selectedNoteId: note.id, focusedCellId: null, ...destination });
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
    const state = get();
    const notes = permanent ? state.notes.filter(note => note.id !== id)
      : state.notes.map(note => note.id === id ? { ...note, isTrashed: true } : note);
    const selectedNoteId = validSelectedNote({ ...state, notes });
    set({ notes, selectedNoteId, focusedCellId: null, searchResults: state.searchResults.filter(note => note.id !== id) });
    if (selectedNoteId) void get().loadNoteBody(selectedNoteId);
  },

  restoreNote: async (id: string) => {
    await db.restoreNote(id);
    const state = get();
    const notes = state.notes.map(note => note.id === id ? { ...note, isTrashed: false } : note);
    const selectedNoteId = validSelectedNote({ ...state, notes });
    set({ notes, selectedNoteId, focusedCellId: null });
    if (selectedNoteId) void get().loadNoteBody(selectedNoteId);
  },

  duplicateNote: async (id: string) => {
    const note = await db.duplicateNote(id);
    set(state => ({ notes: [note, ...state.notes], selectedNoteId: note.id, selectedNotebookId: note.notebookId,
      selectedCollection: null, selectedTagId: null, focusedCellId: null }));
    return note;
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
    const note = get().notes.find(n => n.id === noteId);
    const index = afterCellId ? (note?.cells.findIndex(c => c.id === afterCellId) ?? -1) + 1 : note?.cells.length ?? 0;
    const cell: Cell = { id: uuid(), type, data: '', sortOrder: index,
      language: type === 'code' ? 'javascript' : undefined,
      diagramType: type === 'diagram' ? 'flow' : undefined };
    const previous = pendingCellInsertions.get(noteId);
    const insertion = (async () => {
      if (previous) await previous;
      return db.createCell(noteId, type, afterCellId, cell.id);
    })();
    pendingCellInsertions.set(noteId, insertion);
    set(state => ({
      focusedCellId: state.selectedNoteId === noteId ? cell.id : state.focusedCellId,
      notes: state.notes.map(n => {
        if (n.id !== noteId) return n;
        const cells = [...n.cells];
        cells.splice(index, 0, cell);
        return { ...n, cells: cells.map((c, i) => ({ ...c, sortOrder: i })) };
      }),
    }));
    try {
      await insertion;
      return cell;
    } finally {
      if (pendingCellInsertions.get(noteId) === insertion) pendingCellInsertions.delete(noteId);
    }
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
    await pendingCellInsertions.get(noteId);
    await db.updateCell(noteId, cellId, updates);
  },

  deleteCell: async (noteId: string, cellId: string) => {
    await pendingCellInsertions.get(noteId);
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
    await pendingCellInsertions.get(noteId);
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

    await pendingCellInsertions.get(noteId);
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
    currentLibraryPath = null;
    conversionUndoStack.length = 0;
    noteBodyLoadPromises.clear();
    await db.initDatabase(databasePath);
    await db.ensureInboxNotebook();

    const [tags, notes, notebooks] = await Promise.all([
      db.getAllTags(),
      db.getAllNoteSummaries(true),
      db.getAllNotebooks(),
    ]);
    const path = databasePath ?? 'sqlite:notch.db';
    const preferences = readPreferences(path);
    const next = {
      ...get(),
      notebooks,
      tags,
      notes,
      selectedNotebookId: null,
      selectedCollection: 'all' as SpecialCollection | null,
      selectedTagId: null,
      selectedNoteId: null,
      ...preferences,
    };
    if (next.selectedNotebookId && !notebooks.some(notebook => notebook.id === next.selectedNotebookId)) {
      next.selectedNotebookId = null;
      next.selectedCollection = 'all';
    }
    if (next.selectedTagId && !tags.some(tag => tag.id === next.selectedTagId)) {
      next.selectedTagId = null;
      next.selectedCollection = 'all';
    }
    const selectedNoteId = validSelectedNote(next);
    currentLibraryPath = path;
    set({ ...next, selectedNoteId, focusedCellId: null, searchResults: [], searchQuery: '' });

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
            existing.id === id ? { ...existing, cells: note.cells, bodyLoaded: true } : existing
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

useStore.subscribe((state, previous) => {
  if (currentLibraryPath && preferencesChanged(state, previous)) savePreferences(currentLibraryPath, state);
});

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
