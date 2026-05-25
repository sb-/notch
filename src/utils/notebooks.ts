import type { Notebook } from '../types';

export function isDescendantOf(
  notebooks: Notebook[],
  potentialDescendantId: string,
  ancestorId: string
): boolean {
  let current = notebooks.find(n => n.id === potentialDescendantId);
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = notebooks.find(n => n.id === current!.parentId);
  }
  return false;
}

export function getNotebookSubtreeIds(notebooks: Notebook[], notebookId: string): Set<string> {
  const ids = new Set<string>([notebookId]);
  let added = true;

  while (added) {
    added = false;
    for (const notebook of notebooks) {
      if (notebook.parentId && ids.has(notebook.parentId) && !ids.has(notebook.id)) {
        ids.add(notebook.id);
        added = true;
      }
    }
  }

  return ids;
}
