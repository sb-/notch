import Database from '@tauri-apps/plugin-sql';
import type {
  Notebook,
  Note,
  Cell,
  Tag,
  Resource,
  NotebookRow,
  NoteRow,
  CellRow,
  TagRow,
  ResourceRow,
  CellType,
} from '../types';
import { v4 as uuid } from 'uuid';

let db: Database | null = null;
let currentDbPath: string | null = null;

// Initialize the database connection and create tables
export async function initDatabase(dbPath = 'sqlite:notch.db'): Promise<void> {
  if (db && currentDbPath === dbPath) return;

  if (db) {
    try {
      await db.close(currentDbPath ?? undefined);
    } catch {
      // Ignore close failures; loading the requested database below is authoritative.
    }
  }

  db = await Database.load(dbPath);
  currentDbPath = dbPath;

  // Create tables
  await db.execute(`
    CREATE TABLE IF NOT EXISTS notebooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      sort_order INTEGER,
      created_at INTEGER,
      updated_at INTEGER,
      FOREIGN KEY (parent_id) REFERENCES notebooks(id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL,
      title TEXT NOT NULL,
      is_favorite INTEGER DEFAULT 0,
      is_trashed INTEGER DEFAULT 0,
      sort_order INTEGER,
      created_at INTEGER,
      updated_at INTEGER,
      source_uuid TEXT,
      FOREIGN KEY (notebook_id) REFERENCES notebooks(id)
    )
  `);

  // Add source_uuid column if it doesn't exist (migration for existing DBs)
  try {
    await db.execute(`ALTER TABLE notes ADD COLUMN source_uuid TEXT`);
  } catch {
    // Column already exists
  }

  // Create index for source_uuid lookups
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_notes_source_uuid ON notes(source_uuid)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS cells (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      language TEXT,
      diagram_type TEXT,
      sort_order INTEGER,
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS note_tags (
      note_id TEXT,
      tag_id TEXT,
      PRIMARY KEY (note_id, tag_id),
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT,
      data BLOB,
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
    )
  `);

  // Create full-text search virtual table
  await db.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      note_id,
      title,
      content
    )
  `);

  // Create indexes for better performance
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes(notebook_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_cells_note ON cells(note_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_note_tags_note ON note_tags(note_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_id)`);

  // Backfill FTS index for notes created before notes_fts existed (or that
  // were inserted via paths that bypassed updateNoteFTS). Only runs when the
  // FTS table is empty but notes already exist.
  await backfillFTSIfNeeded();
}

// One-time backfill: populate notes_fts from all existing notes/cells when
// the FTS index is empty but notes exist (e.g., user imported a library or
// upgraded from a version without FTS).
async function backfillFTSIfNeeded(): Promise<void> {
  if (!db) return;
  try {
    const noteCount = await db.select<{ c: number }[]>(
      'SELECT COUNT(*) as c FROM notes'
    );
    const ftsCount = await db.select<{ c: number }[]>(
      'SELECT COUNT(*) as c FROM notes_fts'
    );
    const notes = noteCount[0]?.c ?? 0;
    const ftsRows = ftsCount[0]?.c ?? 0;
    if (notes === 0 || ftsRows >= notes) return;

    // Clear any partial rows then repopulate in SQLite. Doing this note-by-note
    // from JS makes large imported libraries noticeably slower to open.
    await db.execute('DELETE FROM notes_fts');
    await db.execute(`
      INSERT INTO notes_fts (note_id, title, content)
      SELECT
        n.id,
        n.title,
        COALESCE((
          SELECT group_concat(c.data, char(10))
          FROM cells c
          WHERE c.note_id = n.id
          ORDER BY c.sort_order
        ), '')
      FROM notes n
    `);
  } catch (err) {
    console.warn('FTS backfill failed:', err);
  }
}

// Helper to get the database instance
function getDb(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

// Convert database row to Notebook
function rowToNotebook(row: NotebookRow): Notebook {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id ?? undefined,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Convert database row to Note (without cells)
function rowToNote(row: NoteRow, cells: Cell[] = [], tags: string[] = [], bodyLoaded = true): Note {
  return {
    id: row.id,
    notebookId: row.notebook_id,
    title: row.title,
    cells,
    tags,
    isFavorite: row.is_favorite === 1,
    isTrashed: row.is_trashed === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceUuid: row.source_uuid ?? undefined,
    bodyLoaded,
  };
}

// Convert database row to Cell
function rowToCell(row: CellRow): Cell {
  return {
    id: row.id,
    type: row.type,
    data: row.data,
    language: row.language ?? undefined,
    diagramType: row.diagram_type ?? undefined,
    sortOrder: row.sort_order,
  };
}

const NOTE_HYDRATION_BATCH_SIZE = 500;

async function hydrateNoteRows(rows: NoteRow[], includeCells = true): Promise<Note[]> {
  if (rows.length === 0) return [];

  const cellsByNote = new Map<string, Cell[]>();
  const tagsByNote = new Map<string, string[]>();

  for (let i = 0; i < rows.length; i += NOTE_HYDRATION_BATCH_SIZE) {
    const noteIds = rows.slice(i, i + NOTE_HYDRATION_BATCH_SIZE).map(row => row.id);
    const placeholders = noteIds.map(() => '?').join(', ');

    if (includeCells) {
      const cellRows = await getDb().select<CellRow[]>(
        `SELECT * FROM cells WHERE note_id IN (${placeholders}) ORDER BY note_id, sort_order`,
        noteIds
      );
      for (const row of cellRows) {
        const cells = cellsByNote.get(row.note_id) ?? [];
        cells.push(rowToCell(row));
        cellsByNote.set(row.note_id, cells);
      }
    }

    const tagRows = await getDb().select<{ note_id: string; name: string }[]>(
      `SELECT nt.note_id, t.name
       FROM note_tags nt
       JOIN tags t ON t.id = nt.tag_id
       WHERE nt.note_id IN (${placeholders})
       ORDER BY nt.note_id, t.name`,
      noteIds
    );
    for (const row of tagRows) {
      const tags = tagsByNote.get(row.note_id) ?? [];
      tags.push(row.name);
      tagsByNote.set(row.note_id, tags);
    }
  }

  return rows.map(row => rowToNote(
    row,
    includeCells ? cellsByNote.get(row.id) ?? [] : [],
    tagsByNote.get(row.id) ?? [],
    includeCells
  ));
}

// ==================== NOTEBOOK OPERATIONS ====================

export async function getAllNotebooks(): Promise<Notebook[]> {
  const rows = await getDb().select<NotebookRow[]>(
    'SELECT * FROM notebooks ORDER BY sort_order, name'
  );
  return rows.map(rowToNotebook);
}

export async function getNotebook(id: string): Promise<Notebook | null> {
  const rows = await getDb().select<NotebookRow[]>(
    'SELECT * FROM notebooks WHERE id = ?',
    [id]
  );
  return rows.length > 0 ? rowToNotebook(rows[0]) : null;
}

export async function createNotebook(name: string, parentId?: string): Promise<Notebook> {
  const id = uuid();
  const now = Date.now();

  // Get max sort order
  const maxResult = await getDb().select<{ max_order: number | null }[]>(
    'SELECT MAX(sort_order) as max_order FROM notebooks WHERE parent_id IS ?',
    [parentId ?? null]
  );
  const sortOrder = (maxResult[0]?.max_order ?? -1) + 1;

  await getDb().execute(
    `INSERT INTO notebooks (id, name, parent_id, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, name, parentId ?? null, sortOrder, now, now]
  );

  return {
    id,
    name,
    parentId,
    sortOrder,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateNotebook(id: string, updates: Partial<Notebook>): Promise<void> {
  const now = Date.now();
  const fields: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [now];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.parentId !== undefined) {
    fields.push('parent_id = ?');
    values.push(updates.parentId ?? null);
  }
  if (updates.sortOrder !== undefined) {
    fields.push('sort_order = ?');
    values.push(updates.sortOrder);
  }

  values.push(id);
  await getDb().execute(
    `UPDATE notebooks SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
}

export async function deleteNotebook(id: string): Promise<void> {
  // Delete all notes in this notebook first
  const notes = await getNotesByNotebook(id);
  for (const note of notes) {
    await deleteNote(note.id, true);
  }

  // Delete child notebooks recursively
  const children = await getDb().select<NotebookRow[]>(
    'SELECT * FROM notebooks WHERE parent_id = ?',
    [id]
  );
  for (const child of children) {
    await deleteNotebook(child.id);
  }

  await getDb().execute('DELETE FROM notebooks WHERE id = ?', [id]);
}

// ==================== NOTE OPERATIONS ====================

export async function getAllNotes(): Promise<Note[]> {
  const rows = await getDb().select<NoteRow[]>(
    'SELECT * FROM notes WHERE is_trashed = 0 ORDER BY sort_order, updated_at DESC'
  );
  return hydrateNoteRows(rows);
}

export async function getAllNoteSummaries(): Promise<Note[]> {
  const rows = await getDb().select<NoteRow[]>(
    'SELECT * FROM notes WHERE is_trashed = 0 ORDER BY sort_order, updated_at DESC'
  );
  return hydrateNoteRows(rows, false);
}

export async function getNotesByNotebook(notebookId: string): Promise<Note[]> {
  const rows = await getDb().select<NoteRow[]>(
    'SELECT * FROM notes WHERE notebook_id = ? AND is_trashed = 0 ORDER BY sort_order, updated_at DESC',
    [notebookId]
  );
  return hydrateNoteRows(rows);
}

export async function getFavoriteNotes(): Promise<Note[]> {
  const rows = await getDb().select<NoteRow[]>(
    'SELECT * FROM notes WHERE is_favorite = 1 AND is_trashed = 0 ORDER BY updated_at DESC'
  );
  return hydrateNoteRows(rows);
}

export async function getTrashedNotes(): Promise<Note[]> {
  const rows = await getDb().select<NoteRow[]>(
    'SELECT * FROM notes WHERE is_trashed = 1 ORDER BY updated_at DESC'
  );
  return hydrateNoteRows(rows);
}

export async function getRecentNotes(limit = 20): Promise<Note[]> {
  const rows = await getDb().select<NoteRow[]>(
    'SELECT * FROM notes WHERE is_trashed = 0 ORDER BY updated_at DESC LIMIT ?',
    [limit]
  );
  return hydrateNoteRows(rows);
}

export async function getNote(id: string): Promise<Note | null> {
  const rows = await getDb().select<NoteRow[]>(
    'SELECT * FROM notes WHERE id = ?',
    [id]
  );

  if (rows.length === 0) return null;

  const cells = await getCellsByNote(id);
  const tags = await getTagsForNote(id);
  return rowToNote(rows[0], cells, tags, true);
}

export async function getNoteBySourceUuid(sourceUuid: string): Promise<Note | null> {
  const rows = await getDb().select<NoteRow[]>(
    'SELECT * FROM notes WHERE LOWER(source_uuid) = LOWER(?)',
    [sourceUuid]
  );

  if (rows.length === 0) return null;

  const cells = await getCellsByNote(rows[0].id);
  const tags = await getTagsForNote(rows[0].id);
  return rowToNote(rows[0], cells, tags, true);
}

export async function createNote(notebookId: string, title = 'Untitled', sourceUuid?: string): Promise<Note> {
  const id = uuid();
  const now = Date.now();

  // Get max sort order
  const maxResult = await getDb().select<{ max_order: number | null }[]>(
    'SELECT MAX(sort_order) as max_order FROM notes WHERE notebook_id = ?',
    [notebookId]
  );
  const sortOrder = (maxResult[0]?.max_order ?? -1) + 1;

  await getDb().execute(
    `INSERT INTO notes (id, notebook_id, title, is_favorite, is_trashed, sort_order, created_at, updated_at, source_uuid)
     VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?)`,
    [id, notebookId, title, sortOrder, now, now, sourceUuid ?? null]
  );

  // Create a default markdown cell
  const defaultCell = await createCell(id, 'markdown');

  return {
    id,
    notebookId,
    title,
    cells: [defaultCell],
    tags: [],
    isFavorite: false,
    isTrashed: false,
    sortOrder,
    createdAt: now,
    updatedAt: now,
    sourceUuid,
    bodyLoaded: true,
  };
}

export async function updateNote(id: string, updates: Partial<Note>): Promise<void> {
  const updatedAt = updates.updatedAt ?? Date.now();
  const fields: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [updatedAt];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title);
  }
  if (updates.createdAt !== undefined) {
    fields.push('created_at = ?');
    values.push(updates.createdAt);
  }
  if (updates.notebookId !== undefined) {
    fields.push('notebook_id = ?');
    values.push(updates.notebookId);
  }
  if (updates.isFavorite !== undefined) {
    fields.push('is_favorite = ?');
    values.push(updates.isFavorite ? 1 : 0);
  }
  if (updates.isTrashed !== undefined) {
    fields.push('is_trashed = ?');
    values.push(updates.isTrashed ? 1 : 0);
  }
  if (updates.sortOrder !== undefined) {
    fields.push('sort_order = ?');
    values.push(updates.sortOrder);
  }

  values.push(id);
  await getDb().execute(
    `UPDATE notes SET ${fields.join(', ')} WHERE id = ?`,
    values
  );

  // Update FTS index
  await updateNoteFTS(id);
}

export async function deleteNote(id: string, permanent = false): Promise<void> {
  if (permanent) {
    // Remove from FTS
    await getDb().execute('DELETE FROM notes_fts WHERE note_id = ?', [id]);
    // Delete note (cells deleted via CASCADE)
    await getDb().execute('DELETE FROM notes WHERE id = ?', [id]);
  } else {
    // Soft delete (move to trash)
    await updateNote(id, { isTrashed: true });
  }
}

export async function restoreNote(id: string): Promise<void> {
  await updateNote(id, { isTrashed: false });
}

export async function toggleNoteFavorite(id: string): Promise<void> {
  const note = await getNote(id);
  if (note) {
    await updateNote(id, { isFavorite: !note.isFavorite });
  }
}

// ==================== CELL OPERATIONS ====================

export async function getCellsByNote(noteId: string): Promise<Cell[]> {
  const rows = await getDb().select<CellRow[]>(
    'SELECT * FROM cells WHERE note_id = ? ORDER BY sort_order',
    [noteId]
  );
  return rows.map(rowToCell);
}

export async function createCell(
  noteId: string,
  type: CellType,
  afterCellId?: string
): Promise<Cell> {
  const id = uuid();

  // Determine sort order
  let sortOrder: number;
  if (afterCellId) {
    const afterCell = await getDb().select<CellRow[]>(
      'SELECT sort_order FROM cells WHERE id = ?',
      [afterCellId]
    );
    if (afterCell.length > 0) {
      sortOrder = afterCell[0].sort_order + 1;
      // Shift all cells after
      await getDb().execute(
        'UPDATE cells SET sort_order = sort_order + 1 WHERE note_id = ? AND sort_order >= ?',
        [noteId, sortOrder]
      );
    } else {
      sortOrder = 0;
    }
  } else {
    const maxResult = await getDb().select<{ max_order: number | null }[]>(
      'SELECT MAX(sort_order) as max_order FROM cells WHERE note_id = ?',
      [noteId]
    );
    sortOrder = (maxResult[0]?.max_order ?? -1) + 1;
  }

  const defaultLanguage = type === 'code' ? 'javascript' : null;
  const defaultDiagramType = type === 'diagram' ? 'flow' : null;

  await getDb().execute(
    `INSERT INTO cells (id, note_id, type, data, language, diagram_type, sort_order)
     VALUES (?, ?, ?, '', ?, ?, ?)`,
    [id, noteId, type, defaultLanguage, defaultDiagramType, sortOrder]
  );

  // Update note's updated_at
  await getDb().execute(
    'UPDATE notes SET updated_at = ? WHERE id = ?',
    [Date.now(), noteId]
  );

  return {
    id,
    type,
    data: '',
    language: defaultLanguage ?? undefined,
    diagramType: defaultDiagramType ?? undefined,
    sortOrder,
  };
}

export async function updateCell(
  noteId: string,
  cellId: string,
  updates: Partial<Cell>
): Promise<void> {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.data !== undefined) {
    fields.push('data = ?');
    values.push(updates.data);
  }
  if (updates.type !== undefined) {
    fields.push('type = ?');
    values.push(updates.type);
  }
  if ('language' in updates) {
    fields.push('language = ?');
    values.push(updates.language ?? null);
  }
  if ('diagramType' in updates) {
    fields.push('diagram_type = ?');
    values.push(updates.diagramType ?? null);
  }
  if (updates.sortOrder !== undefined) {
    fields.push('sort_order = ?');
    values.push(updates.sortOrder);
  }

  if (fields.length > 0) {
    values.push(cellId);
    await getDb().execute(
      `UPDATE cells SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    // Update note's updated_at and FTS
    await getDb().execute(
      'UPDATE notes SET updated_at = ? WHERE id = ?',
      [Date.now(), noteId]
    );
    await updateNoteFTS(noteId);
  }
}

export async function deleteCell(noteId: string, cellId: string): Promise<void> {
  await getDb().execute('DELETE FROM cells WHERE id = ?', [cellId]);

  // Re-index sort orders
  const cells = await getCellsByNote(noteId);
  for (let i = 0; i < cells.length; i++) {
    await getDb().execute(
      'UPDATE cells SET sort_order = ? WHERE id = ?',
      [i, cells[i].id]
    );
  }

  // Update note
  await getDb().execute(
    'UPDATE notes SET updated_at = ? WHERE id = ?',
    [Date.now(), noteId]
  );
  await updateNoteFTS(noteId);
}

export async function moveCell(
  noteId: string,
  cellId: string,
  newIndex: number
): Promise<void> {
  const cells = await getCellsByNote(noteId);
  const currentIndex = cells.findIndex(c => c.id === cellId);

  if (currentIndex === -1 || currentIndex === newIndex) return;

  // Remove cell from current position and insert at new position
  const [cell] = cells.splice(currentIndex, 1);
  cells.splice(newIndex, 0, cell);

  // Update all sort orders
  for (let i = 0; i < cells.length; i++) {
    await getDb().execute(
      'UPDATE cells SET sort_order = ? WHERE id = ?',
      [i, cells[i].id]
    );
  }

  await getDb().execute(
    'UPDATE notes SET updated_at = ? WHERE id = ?',
    [Date.now(), noteId]
  );
}

function normalizeMarkdown(md: string): string {
  return md
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeInlineText(text: string): string {
  return text.replace(/\s+/g, ' ');
}

function styleIncludes(style: string, pattern: RegExp): boolean {
  return pattern.test(style.replace(/\s+/g, '').toLowerCase());
}

function renderChildren(node: Node, listDepth = 0): string {
  return Array.from(node.childNodes)
    .map(child => renderNode(child, listDepth))
    .join('');
}

function renderBlock(content: string): string {
  const cleaned = normalizeMarkdown(content);
  return cleaned ? `${cleaned}\n\n` : '';
}

function renderList(list: Element, ordered: boolean, depth: number): string {
  let index = 1;
  return Array.from(list.children)
    .filter(child => child.tagName.toLowerCase() === 'li')
    .map(item => renderListItem(item, ordered, depth, index++))
    .join('');
}

function renderListItem(item: Element, ordered: boolean, depth: number, index: number): string {
  const indent = '  '.repeat(depth);
  const marker = ordered ? `${index}. ` : '- ';
  let content = '';
  let nested = '';

  for (const child of Array.from(item.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = (child as Element).tagName.toLowerCase();
      if (tag === 'ul' || tag === 'ol') {
        nested += renderList(child as Element, tag === 'ol', depth + 1);
        continue;
      }
    }
    content += renderNode(child, depth);
  }

  const lines = normalizeMarkdown(content).split('\n').filter(Boolean);
  const firstLine = lines.shift() ?? '';
  const continuation = lines.map(line => `${indent}  ${line}`).join('\n');
  const nestedBlock = nested ? `\n${nested.trimEnd()}` : '';
  const textBlock = continuation ? `${firstLine}\n${continuation}` : firstLine;

  return `${indent}${marker}${textBlock}${nestedBlock}\n`;
}

function renderNode(node: Node, listDepth = 0): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return normalizeInlineText(node.textContent ?? '');
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  const children = () => renderChildren(element, listDepth);
  const text = () => element.textContent ?? '';

  if (tag === 'script' || tag === 'style' || tag === 'meta' || tag === 'link') return '';
  if (tag === 'br') return '\n';
  if (tag === 'hr') return '\n---\n\n';
  if (tag === 'ul') return `${renderList(element, false, listDepth)}\n`;
  if (tag === 'ol') return `${renderList(element, true, listDepth)}\n`;
  if (tag === 'li') return renderListItem(element, false, listDepth, 1);
  if (tag === 'pre') return `\n\`\`\`\n${text().replace(/\n+$/g, '')}\n\`\`\`\n\n`;
  if (tag === 'code') return `\`${text().replace(/`/g, '\\`')}\``;
  if (tag === 'blockquote') {
    const quote = normalizeMarkdown(children());
    return quote ? `${quote.split('\n').map(line => `> ${line}`).join('\n')}\n\n` : '';
  }
  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    return `${'#'.repeat(level)} ${normalizeMarkdown(children())}\n\n`;
  }
  if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') {
    return renderBlock(children());
  }
  if (tag === 'a') {
    const label = normalizeMarkdown(children()) || element.getAttribute('href') || '';
    const href = element.getAttribute('href');
    return href ? `[${label}](${href})` : label;
  }
  if (tag === 'strong' || tag === 'b') return `**${normalizeMarkdown(children())}**`;
  if (tag === 'em' || tag === 'i') return `*${normalizeMarkdown(children())}*`;
  if (tag === 's' || tag === 'strike' || tag === 'del') return `~~${normalizeMarkdown(children())}~~`;

  const style = element.getAttribute('style') ?? '';
  const rendered = children();
  if (styleIncludes(style, /font-weight:(bold|[6-9]00)/)) return `**${normalizeMarkdown(rendered)}**`;
  if (styleIncludes(style, /font-style:italic/)) return `*${normalizeMarkdown(rendered)}*`;

  return rendered;
}

// Convert HTML to Markdown
function htmlToMarkdown(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return normalizeMarkdown(renderChildren(doc.body));
}

export async function convertCell(
  noteId: string,
  cellId: string,
  newType: CellType
): Promise<Cell | null> {
  // Get current cell to check its type and data
  const cells = await getCellsByNote(noteId);
  const currentCell = cells.find(c => c.id === cellId);
  if (!currentCell) return null;

  const currentType = currentCell?.type;
  const currentData = currentCell?.data || '';

  const updates: Partial<Cell> = { type: newType };

  // Convert content between text (HTML) and markdown
  if (currentType === 'text' && newType === 'markdown') {
    updates.data = htmlToMarkdown(currentData);
  }

  // Set appropriate defaults for the new type
  if (newType === 'code') {
    updates.language = 'javascript';
    updates.diagramType = undefined;
  } else if (newType === 'diagram') {
    updates.diagramType = 'flow';
    updates.language = undefined;
  } else {
    updates.language = undefined;
    updates.diagramType = undefined;
  }

  await updateCell(noteId, cellId, updates);
  return { ...currentCell, ...updates };
}

// ==================== RESOURCE OPERATIONS ====================

function rowToResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    noteId: row.note_id,
    filename: row.filename,
    mimeType: row.mime_type ?? undefined,
    data: row.data,
  };
}

export async function getResourcesByNote(noteId: string): Promise<Resource[]> {
  const rows = await getDb().select<ResourceRow[]>(
    'SELECT * FROM resources WHERE note_id = ?',
    [noteId]
  );
  return rows.map(rowToResource);
}

export async function createResource(
  noteId: string,
  filename: string,
  mimeType: string | undefined,
  base64: string
): Promise<Resource> {
  const id = uuid();
  await getDb().execute(
    'INSERT INTO resources (id, note_id, filename, mime_type, data) VALUES (?, ?, ?, ?, ?)',
    [id, noteId, filename, mimeType ?? null, base64]
  );
  return { id, noteId, filename, mimeType, data: base64 };
}

// ==================== TAG OPERATIONS ====================

export async function getAllTags(): Promise<Tag[]> {
  const rows = await getDb().select<TagRow[]>(
    'SELECT * FROM tags ORDER BY name'
  );
  return rows.map(row => ({ id: row.id, name: row.name }));
}

export async function getTagsForNote(noteId: string): Promise<string[]> {
  const rows = await getDb().select<{ name: string }[]>(
    `SELECT t.name FROM tags t
     JOIN note_tags nt ON t.id = nt.tag_id
     WHERE nt.note_id = ?
     ORDER BY t.name`,
    [noteId]
  );
  return rows.map(row => row.name);
}

export async function getNotesByTag(tagId: string): Promise<Note[]> {
  const rows = await getDb().select<NoteRow[]>(
    `SELECT n.* FROM notes n
     JOIN note_tags nt ON n.id = nt.note_id
     WHERE nt.tag_id = ? AND n.is_trashed = 0
     ORDER BY n.updated_at DESC`,
    [tagId]
  );
  return hydrateNoteRows(rows);
}

export async function createTag(name: string): Promise<Tag> {
  const id = uuid();
  await getDb().execute(
    'INSERT INTO tags (id, name) VALUES (?, ?)',
    [id, name]
  );
  return { id, name };
}

export async function deleteTag(id: string): Promise<void> {
  await getDb().execute('DELETE FROM note_tags WHERE tag_id = ?', [id]);
  await getDb().execute('DELETE FROM tags WHERE id = ?', [id]);
}

export async function addTagToNote(noteId: string, tagId: string): Promise<void> {
  await getDb().execute(
    'INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)',
    [noteId, tagId]
  );
}

export async function removeTagFromNote(noteId: string, tagId: string): Promise<void> {
  await getDb().execute(
    'DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?',
    [noteId, tagId]
  );
}

// ==================== SEARCH OPERATIONS ====================

async function updateNoteFTS(noteId: string): Promise<void> {
  const note = await getNote(noteId);
  if (!note) return;

  // Combine all cell content for search, dropping embedded resource refs so they
  // don't pollute the index.
  const content = note.cells
    .map(cell => cell.data)
    .join('\n')
    .replace(/notch-resource:\/\/[\w-]+/g, ' ');

  // Remove existing entry
  await getDb().execute('DELETE FROM notes_fts WHERE note_id = ?', [noteId]);

  // Insert new entry
  await getDb().execute(
    'INSERT INTO notes_fts (note_id, title, content) VALUES (?, ?, ?)',
    [noteId, note.title, content]
  );
}

export async function searchNotes(query: string): Promise<Note[]> {
  if (!query.trim()) return [];

  // Prepare FTS5 query: sanitize each term to avoid FTS5 syntax errors.
  // FTS5 treats double quotes, asterisks, parentheses, colons, and other
  // characters as operators. We strip them from each token and wrap the
  // result in double quotes (a "phrase") so the user's literal text is
  // matched verbatim. Empty tokens (after sanitization) are dropped.
  const terms = query
    .split(/\s+/)
    .map(term => term.replace(/["*():^+\-]/g, '').trim())
    .filter(term => term.length > 0);

  if (terms.length === 0) return [];

  const ftsQuery = terms.map(term => `"${term}"*`).join(' OR ');

  let rows: NoteRow[];
  try {
    rows = await getDb().select<NoteRow[]>(
      `SELECT n.*
       FROM notes_fts
       JOIN notes n ON n.id = notes_fts.note_id
       WHERE notes_fts MATCH ? AND n.is_trashed = 0
       ORDER BY rank`,
      [ftsQuery]
    );
  } catch (err) {
    // FTS5 parser threw (e.g., malformed query) — return no results
    // instead of bubbling an exception up to the UI.
    console.warn('FTS5 query failed:', err);
    return [];
  }

  return hydrateNoteRows(rows);
}

// ==================== LINK REWRITING ====================

/**
 * Rewrite quiver-note-url:// links to notch://note/ links in all cell data.
 * Builds a map from Quiver source UUIDs to Notch note IDs, then replaces
 * all matching URLs in cell data.
 */
export async function rewriteQuiverNoteLinks(): Promise<number> {
  // Build UUID → note ID map from all notes with a source_uuid
  // Use lowercase keys for case-insensitive matching
  const noteRows = await getDb().select<{ id: string; source_uuid: string }[]>(
    'SELECT id, source_uuid FROM notes WHERE source_uuid IS NOT NULL'
  );
  const uuidToNoteId = new Map<string, string>();
  for (const row of noteRows) {
    uuidToNoteId.set(row.source_uuid.toLowerCase(), row.id);
  }
  if (uuidToNoteId.size === 0) return 0;

  // Find all cells that contain quiver-note-url links
  const cellRows = await getDb().select<{ id: string; note_id: string; data: string }[]>(
    "SELECT id, note_id, data FROM cells WHERE data LIKE '%quiver-note-url%'"
  );

  let rewritten = 0;
  for (const cell of cellRows) {
    const updated = cell.data.replace(
      /quiver-note-url:?\/?\/?\/?([0-9A-Fa-f-]+)/gi,
      (match, quiverUuid) => {
        const noteId = uuidToNoteId.get(quiverUuid.toLowerCase());
        if (noteId) {
          rewritten++;
          return `notch://note/${noteId}`;
        }
        return match; // leave unresolved links unchanged
      }
    );
    if (updated !== cell.data) {
      await getDb().execute('UPDATE cells SET data = ? WHERE id = ?', [updated, cell.id]);
    }
  }

  return rewritten;
}

// ==================== INITIALIZATION ====================

export async function ensureInboxNotebook(): Promise<Notebook> {
  const rows = await getDb().select<NotebookRow[]>(
    'SELECT * FROM notebooks WHERE name = ? LIMIT 1',
    ['Inbox']
  );
  let inbox = rows.length > 0 ? rowToNotebook(rows[0]) : null;

  if (!inbox) {
    inbox = await createNotebook('Inbox');
  }

  return inbox;
}
