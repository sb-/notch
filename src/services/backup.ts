import type { Notebook, Note, Tag, Resource, Cell } from '../types';

export interface LibraryBackup {
  version: 2;
  exportedAt: number;
  notebooks: Notebook[];
  notes: Note[];
  tags: Tag[];
  resources: Resource[];
}

const types = new Set(['text', 'markdown', 'code', 'latex', 'diagram']);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid backup record.');
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid backup text field.');
  return value;
}
function id(value: unknown): string {
  const result = string(value);
  if (!result.trim()) throw new Error('Missing backup identifier.');
  return result;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid backup number.');
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid backup boolean.');
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid backup list.');
  return value;
}
function unique(values: string[], description: string): Set<string> {
  const keys = new Set(values);
  if (keys.size !== values.length) throw new Error(`Duplicate ${description} in backup.`);
  return keys;
}
function cell(value: unknown): Cell {
  const c = object(value);
  if (!types.has(string(c.type))) throw new Error('Unknown cell type in backup.');
  if (c.diagramType !== undefined && c.diagramType !== 'sequence' && c.diagramType !== 'flow') throw new Error('Invalid diagram type.');
  return { id: id(c.id), type: c.type as Cell['type'], data: string(c.data), sortOrder: number(c.sortOrder),
    language: c.language === undefined ? undefined : string(c.language), diagramType: c.diagramType as Cell['diagramType'] };
}

/** Validate the entire graph before creating or writing a destination library. */
export function parseLibraryBackup(json: string): LibraryBackup {
  const data = object(JSON.parse(json));
  if (data.version !== 2) throw new Error('This is not a complete Notch backup (version 2). Older JSON exports omit resources and cannot be fully restored.');
  const notebooks = array(data.notebooks).map(value => {
    const n = object(value);
    return { id: id(n.id), name: string(n.name), parentId: n.parentId == null ? undefined : id(n.parentId),
      sortOrder: number(n.sortOrder), createdAt: number(n.createdAt), updatedAt: number(n.updatedAt) };
  });
  const tags = array(data.tags).map(value => { const t = object(value); return { id: id(t.id), name: string(t.name) }; });
  const notes = array(data.notes).map(value => {
    const n = object(value);
    return { id: id(n.id), notebookId: id(n.notebookId), title: string(n.title),
      cells: array(n.cells).map(cell), tags: array(n.tags).map(string), isFavorite: bool(n.isFavorite), isTrashed: bool(n.isTrashed),
      sortOrder: number(n.sortOrder), createdAt: number(n.createdAt), updatedAt: number(n.updatedAt),
      sourceUuid: n.sourceUuid === undefined ? undefined : string(n.sourceUuid) };
  });
  const resources = array(data.resources).map(value => {
    const r = object(value);
    const bytes = string(r.data);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(bytes)) throw new Error('Invalid resource encoding.');
    return { id: id(r.id), noteId: id(r.noteId), filename: string(r.filename), data: bytes,
      mimeType: r.mimeType == null ? undefined : string(r.mimeType) };
  });
  const notebookIds = unique(notebooks.map(n => n.id), 'notebook identifier');
  const noteIds = unique(notes.map(n => n.id), 'note identifier');
  unique(tags.map(t => t.id), 'tag identifier');
  const tagNames = unique(tags.map(t => t.name), 'tag name');
  const resourceIds = unique(resources.map(r => r.id), 'resource identifier');
  unique(notes.flatMap(n => n.cells.map(c => c.id)), 'cell identifier');
  const byNotebook = new Map(notebooks.map(n => [n.id, n]));
  for (const n of notebooks) {
    const seen = new Set([n.id]);
    let parent = n.parentId;
    while (parent) {
      if (!notebookIds.has(parent) || seen.has(parent)) throw new Error('Invalid notebook hierarchy.');
      seen.add(parent); parent = byNotebook.get(parent)!.parentId;
    }
  }
  for (const n of notes) {
    if (!notebookIds.has(n.notebookId) || n.tags.some(t => !tagNames.has(t))) throw new Error('Note references a missing notebook or tag.');
    unique(n.tags, 'note tag');
    for (const c of n.cells) for (const match of c.data.matchAll(/notch-resource:\/\/([\w-]+)/g)) {
      if (!resourceIds.has(match[1]!) || resources.find(r => r.id === match[1])?.noteId !== n.id) throw new Error('Backup is missing an embedded resource.');
    }
  }
  if (resources.some(r => !noteIds.has(r.noteId))) throw new Error('Resource references a missing note.');
  return { version: 2, exportedAt: number(data.exportedAt), notebooks, notes, tags, resources };
}
