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

type CellChange = { noteId: string; before: Cell[]; after: Cell[]; focusBefore: string | null; focusAfter: string | null };
const cellUndo = new Map<string, CellChange[]>();
const cellRedo = new Map<string, CellChange[]>();
let navigatingHistory = false;
export function hasCellHistory(noteId: string, redo = false): boolean {
  return Boolean((redo ? cellRedo : cellUndo).get(noteId)?.length);
}
const cloneCells = (cells: Cell[]) => cells.map(cell => ({ ...cell }));
function rememberCellChange(change: CellChange): void {
  const stack = cellUndo.get(change.noteId) ?? [];
  stack.push(change);
  if (stack.length > 100) stack.shift();
  cellUndo.set(change.noteId, stack);
  cellRedo.delete(change.noteId);
}

// Per-note insertion barriers keep rapid insertions and edits ordered on disk.
const pendingCellInsertions = new Map<string, Promise<unknown>>();
const noteBodyLoadPromises = new Map<string, Promise<void>>();
let currentLibraryPath: string | null = null;

export async function flushPendingChanges(): Promise<void> {
  await Promise.all([...pendingCellInsertions.values()]);
  await db.flushSearchIndex();
}

export const useStore = create<Store>((set, get) => ({
  // Initial UI state
  scrollSync: false,
  navigationHistory: [],
  navigationIndex: -1,
  cellHistoryVersion: 0,
  lastChangeWasStructural: false,
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

  toggleScrollSync: () => set(state => ({ scrollSync: !state.scrollSync })),
  navigateHistory: async (direction) => {
    const state = get();
    let index = state.navigationIndex + direction;
    while (index >= 0 && index < state.navigationHistory.length) {
      const note = state.notes.find(n => n.id === state.navigationHistory[index] && !n.isTrashed);
      if (note) {
        navigatingHistory = true;
        set({ navigationIndex: index, selectedNoteId: note.id, selectedNotebookId: note.notebookId,
          selectedCollection: null, selectedTagId: null, focusedCellId: null, lastChangeWasStructural: false });
        navigatingHistory = false;
        await get().loadNoteBody(note.id);
        return;
      }
      index += direction;
    }
  },
  changeCells: async (noteId, cells, focusId) => {
    const state = get();
    const note = state.notes.find(n => n.id === noteId);
    if (!note || !cells.length) return;
    const next = cells.map((cell, sortOrder) => ({ ...cell, sortOrder }));
    rememberCellChange({ noteId, before: cloneCells(note.cells), after: cloneCells(next),
      focusBefore: state.focusedCellId, focusAfter: focusId ?? next[0].id });
    set({ notes: state.notes.map(n => n.id === noteId ? { ...n, cells: next, updatedAt: Date.now() } : n),
      focusedCellId: focusId ?? next[0].id, cellHistoryVersion: state.cellHistoryVersion + 1, lastChangeWasStructural: true });
    const previous = pendingCellInsertions.get(noteId);
    const work = (async () => { await previous; await db.replaceNoteCells(noteId, next); })();
    pendingCellInsertions.set(noteId, work);
    try { await work; }
    catch (error) {
      if (pendingCellInsertions.get(noteId) === work) {
        const saved = await db.getNote(noteId);
        cellUndo.delete(noteId); cellRedo.delete(noteId);
        set(current => ({ notes: current.notes.map(n => n.id === noteId && saved ? saved : n),
          cellHistoryVersion: current.cellHistoryVersion + 1, lastChangeWasStructural: false }));
      }
      throw error;
    } finally { if (pendingCellInsertions.get(noteId) === work) pendingCellInsertions.delete(noteId); }
  },
  undoCellChange: async (redo = false) => {
    const id = get().selectedNoteId;
    if (!id) return false;
    const previous = pendingCellInsertions.get(id);
    const work = (async () => {
      await previous;
      const source = redo ? cellRedo : cellUndo;
      const target = redo ? cellUndo : cellRedo;
      const change = source.get(id)?.at(-1);
      if (!change) return false;
      const currentCells = cloneCells(get().notes.find(n => n.id === id)!.cells);
      const cells = cloneCells(redo ? change.after : change.before);
      // Preserve edits in cells that the structural operation did not change.
      for (let i = 0; i < cells.length; i++) {
        const before = change.before.find(c => c.id === cells[i].id);
        const after = change.after.find(c => c.id === cells[i].id);
        const current = currentCells.find(c => c.id === cells[i].id);
        if (before && after && current && before.data === after.data && before.type === after.type) {
          cells[i] = { ...current, sortOrder: i };
        }
      }
      await db.replaceNoteCells(id, cells);
      if (redo) change.before = currentCells; else change.after = currentCells;
      source.get(id)!.pop();
      target.set(id, [...(target.get(id) ?? []), change]);
      set(current => ({ notes: current.notes.map(n => n.id === id ? { ...n, cells, updatedAt: Date.now() } : n),
        focusedCellId: redo ? change.focusAfter : change.focusBefore,
        cellHistoryVersion: current.cellHistoryVersion + 1, lastChangeWasStructural: true }));
      return true;
    })();
    pendingCellInsertions.set(id, work);
    try { return await work; }
    finally { if (pendingCellInsertions.get(id) === work) pendingCellInsertions.delete(id); }
  },

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

  selectNote: async (id: string | null, revealNotebook = false) => {
    const note = revealNotebook ? get().notes.find(n => n.id === id) : undefined;
    set({ selectedNoteId: id, ...(note ? { selectedNotebookId: note.notebookId,
      selectedCollection: null, selectedTagId: null } : {}) });
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
    if (note) {
      const after = cloneCells(note.cells); after.splice(index, 0, cell);
      rememberCellChange({ noteId, before: cloneCells(note.cells), after,
        focusBefore: get().focusedCellId, focusAfter: cell.id });
    }
    const previous = pendingCellInsertions.get(noteId);
    const insertion = (async () => {
      if (previous) await previous;
      return db.createCell(noteId, type, afterCellId, cell.id);
    })();
    pendingCellInsertions.set(noteId, insertion);
    set(state => ({
      cellHistoryVersion: state.cellHistoryVersion + 1, lastChangeWasStructural: true,
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
      lastChangeWasStructural: false,
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

  deleteCell: async (noteId, cellId) => {
    const note = get().notes.find(n => n.id === noteId);
    if (!note || note.cells.length < 2) return;
    const index = note.cells.findIndex(c => c.id === cellId);
    await get().changeCells(noteId, note.cells.filter(c => c.id !== cellId), note.cells[Math.max(0, index - 1)]?.id);
  },
  moveCell: async (noteId, cellId, newIndex) => {
    const note = get().notes.find(n => n.id === noteId);
    if (!note) return;
    const cells = [...note.cells];
    const index = cells.findIndex(c => c.id === cellId);
    if (index < 0) return;
    if (Math.max(0, Math.min(newIndex, cells.length - 1)) === index) return;
    const [cell] = cells.splice(index, 1);
    cells.splice(Math.max(0, Math.min(newIndex, cells.length)), 0, cell);
    await get().changeCells(noteId, cells, cellId);
  },
  convertCell: async (noteId, cellId, newType) => {
    const note = get().notes.find(n => n.id === noteId);
    const before = note && cloneCells(note.cells);
    if (!note || !before || note.cells.find(c => c.id === cellId)?.type === newType) return;
    await pendingCellInsertions.get(noteId);
    const converted = await db.convertCell(noteId, cellId, newType);
    if (converted) await get().changeCells(noteId, before.map(c => c.id === cellId ? converted : c), cellId);
  },
  undoLastCellConversion: async () => get().undoCellChange(),

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
    await Promise.all([...pendingCellInsertions.values()]);
    currentLibraryPath = null;
    cellUndo.clear(); cellRedo.clear();
    set({ navigationHistory: [], navigationIndex: -1, lastChangeWasStructural: false });
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
  if (!navigatingHistory && currentLibraryPath && state.selectedNoteId && state.selectedNoteId !== previous.selectedNoteId) {
    const history = state.navigationHistory.slice(0, state.navigationIndex + 1);
    if (history.at(-1) !== state.selectedNoteId) {
      history.push(state.selectedNoteId);
      if (history.length > 100) history.shift();
      useStore.setState({ navigationHistory: history, navigationIndex: history.length - 1, lastChangeWasStructural: false });
    }
  }
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
