import type { AppState } from '../types';

const fields = ['layoutMode', 'editorViewMode', 'sidebarVisible', 'sortBy', 'sortOrder',
  'selectedCollection', 'selectedNotebookId', 'selectedTagId', 'selectedNoteId'] as const;
type Preferences = Pick<AppState, typeof fields[number]>;

export function readPreferences(path: string): Partial<Preferences> {
  try {
    const value = JSON.parse(localStorage.getItem(`notch.view.${path}`) || '{}');
    const result: Partial<Preferences> = {};
    if (['single', 'double', 'triple'].includes(value.layoutMode)) result.layoutMode = value.layoutMode;
    if (['editor', 'preview', 'split'].includes(value.editorViewMode)) result.editorViewMode = value.editorViewMode;
    if (typeof value.sidebarVisible === 'boolean') result.sidebarVisible = value.sidebarVisible;
    if (['title', 'createdAt', 'updatedAt', 'manual'].includes(value.sortBy)) result.sortBy = value.sortBy;
    if (['asc', 'desc'].includes(value.sortOrder)) result.sortOrder = value.sortOrder;
    if (value.selectedCollection === null || ['inbox', 'all', 'favorites', 'trash', 'recents'].includes(value.selectedCollection)) {
      result.selectedCollection = value.selectedCollection;
    }
    for (const field of ['selectedNotebookId', 'selectedTagId', 'selectedNoteId'] as const) {
      if (value[field] === null || typeof value[field] === 'string') result[field] = value[field];
    }
    return result;
  } catch { return {}; }
}

export function savePreferences(path: string, state: AppState): void {
  try {
    localStorage.setItem(`notch.view.${path}`, JSON.stringify(Object.fromEntries(fields.map(field => [field, state[field]]))));
  } catch { /* Unavailable storage must not block editing. */ }
}

export function preferencesChanged(a: AppState, b: AppState): boolean {
  return fields.some(field => a[field] !== b[field]);
}
