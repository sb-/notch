import type { AppState, Note } from '../types';
import { getNotebookSubtreeIds } from './notebooks';

/** The list and selection recovery must agree about which notes are visible. */
export function visibleNotes(state: AppState): Note[] {
  const { notes, notebooks, tags, selectedNotebookId, selectedTagId, selectedCollection, sortBy, sortOrder } = state;
  let filtered: Note[];
  if (selectedNotebookId) {
    const ids = getNotebookSubtreeIds(notebooks, selectedNotebookId);
    filtered = notes.filter(note => ids.has(note.notebookId) && !note.isTrashed);
  } else if (selectedTagId) {
    const tag = tags.find(tag => tag.id === selectedTagId);
    filtered = notes.filter(note => !!tag && note.tags.includes(tag.name) && !note.isTrashed);
  } else if (selectedCollection === 'trash') {
    filtered = notes.filter(note => note.isTrashed);
  } else {
    filtered = notes.filter(note => !note.isTrashed);
    if (selectedCollection === 'favorites') filtered = filtered.filter(note => note.isFavorite);
    if (selectedCollection === 'inbox') {
      const inbox = notebooks.find(notebook => notebook.name === 'Inbox' && !notebook.parentId);
      filtered = filtered.filter(note => note.notebookId === inbox?.id);
    }
    if (selectedCollection === 'recents') filtered = [...filtered].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);
  }
  return [...filtered].sort((a, b) => {
    const comparison = sortBy === 'title' ? a.title.localeCompare(b.title)
      : sortBy === 'createdAt' ? a.createdAt - b.createdAt
      : sortBy === 'manual' ? a.sortOrder - b.sortOrder : a.updatedAt - b.updatedAt;
    return (sortOrder === 'asc' ? comparison : -comparison) || a.id.localeCompare(b.id);
  });
}

export function validSelectedNote(state: AppState): string | null {
  const visible = visibleNotes(state);
  return visible.some(note => note.id === state.selectedNoteId) ? state.selectedNoteId : visible[0]?.id ?? null;
}
