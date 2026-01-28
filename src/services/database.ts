import Database from '@tauri-apps/plugin-sql';
import type {
  Notebook,
  Note,
  Cell,
  Tag,
  NotebookRow,
  NoteRow,
  CellRow,
  TagRow,
  CellType,
} from '../types';
import { v4 as uuid } from 'uuid';

let db: Database | null = null;

// Initialize the database connection and create tables
export async function initDatabase(): Promise<void> {
  db = await Database.load('sqlite:notch.db');

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
function rowToNote(row: NoteRow, cells: Cell[] = [], tags: string[] = []): Note {
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

  const notes: Note[] = [];
  for (const row of rows) {
    const cells = await getCellsByNote(row.id);
    const tags = await getTagsForNote(row.id);
    notes.push(rowToNote(row, cells, tags));
  }
  return notes;
}

export async function getNotesByNotebook(notebookId: string): Promise<Note[]> {
  const rows = await getDb().select<NoteRow[]>(
    'SELECT * FROM notes WHERE notebook_id = ? AND is_trashed = 0 ORDER BY sort_order, updated_at DESC',
    [notebookId]
  );

  const notes: Note[] = [];
  for (const row of rows) {
    const cells = await getCellsByNote(row.id);
    const tags = await getTagsForNote(row.id);
    notes.push(rowToNote(row, cells, tags));
  }
  return notes;
}

export async function getFavoriteNotes(): Promise<Note[]> {
  const rows = await getDb().select<NoteRow[]>(
    'SELECT * FROM notes WHERE is_favorite = 1 AND is_trashed = 0 ORDER BY updated_at DESC'
  );

  const notes: Note[] = [];
  for (const row of rows) {
    const cells = await getCellsByNote(row.id);
    const tags = await getTagsForNote(row.id);
    notes.push(rowToNote(row, cells, tags));
  }
  return notes;
}

export async function getTrashedNotes(): Promise<Note[]> {
  const rows = await getDb().select<NoteRow[]>(
    'SELECT * FROM notes WHERE is_trashed = 1 ORDER BY updated_at DESC'
  );

  const notes: Note[] = [];
  for (const row of rows) {
    const cells = await getCellsByNote(row.id);
    const tags = await getTagsForNote(row.id);
    notes.push(rowToNote(row, cells, tags));
  }
  return notes;
}

export async function getRecentNotes(limit = 20): Promise<Note[]> {
  const rows = await getDb().select<NoteRow[]>(
    'SELECT * FROM notes WHERE is_trashed = 0 ORDER BY updated_at DESC LIMIT ?',
    [limit]
  );

  const notes: Note[] = [];
  for (const row of rows) {
    const cells = await getCellsByNote(row.id);
    const tags = await getTagsForNote(row.id);
    notes.push(rowToNote(row, cells, tags));
  }
  return notes;
}

export async function getNote(id: string): Promise<Note | null> {
  const rows = await getDb().select<NoteRow[]>(
    'SELECT * FROM notes WHERE id = ?',
    [id]
  );

  if (rows.length === 0) return null;

  const cells = await getCellsByNote(id);
  const tags = await getTagsForNote(id);
  return rowToNote(rows[0], cells, tags);
}

export async function getNoteBySourceUuid(sourceUuid: string): Promise<Note | null> {
  const rows = await getDb().select<NoteRow[]>(
    'SELECT * FROM notes WHERE source_uuid = ?',
    [sourceUuid]
  );

  if (rows.length === 0) return null;

  const cells = await getCellsByNote(rows[0].id);
  const tags = await getTagsForNote(rows[0].id);
  return rowToNote(rows[0], cells, tags);
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
  };
}

export async function updateNote(id: string, updates: Partial<Note>): Promise<void> {
  const now = Date.now();
  const fields: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [now];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title);
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
  if (updates.language !== undefined) {
    fields.push('language = ?');
    values.push(updates.language ?? null);
  }
  if (updates.diagramType !== undefined) {
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

// Convert HTML to Markdown
function htmlToMarkdown(html: string): string {
  let md = html;

  // First, handle nested formatting by processing from inside out
  // Convert links: <a href="url" ...>content</a> -> [content](url)
  // Also handle links without href (just extract text)
  md = md.replace(/<a\s+[^>]*>([\s\S]*?)<\/a>/gi, (match, content) => {
    // Try to extract href
    const hrefMatch = match.match(/href="([^"]*)"/i);
    const href = hrefMatch ? hrefMatch[1] : null;
    // Strip any HTML tags from the link content
    const cleanContent = content.replace(/<[^>]+>/g, '').trim();

    if (href && cleanContent) {
      return `[${cleanContent}](${href})`;
    } else {
      // No href or no content, just return the text
      return cleanContent;
    }
  });

  // Convert bold: <strong ...> or <b ...> -> **
  md = md.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');

  // Convert italic: <em ...> or <i ...> -> *
  md = md.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');

  // Convert underline: <u ...> -> just text (markdown doesn't support underline)
  md = md.replace(/<u\b[^>]*>([\s\S]*?)<\/u>/gi, '$1');

  // Convert strikethrough: <s>, <strike>, <del> -> ~~
  md = md.replace(/<(s|strike|del)\b[^>]*>([\s\S]*?)<\/\1>/gi, '~~$2~~');

  // Convert code: <code ...> -> `
  md = md.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // Convert pre blocks
  md = md.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');

  // Convert headings (with any attributes)
  md = md.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_, content) => `# ${content.replace(/<[^>]+>/g, '').trim()}\n`);
  md = md.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_, content) => `## ${content.replace(/<[^>]+>/g, '').trim()}\n`);
  md = md.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_, content) => `### ${content.replace(/<[^>]+>/g, '').trim()}\n`);
  md = md.replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, (_, content) => `#### ${content.replace(/<[^>]+>/g, '').trim()}\n`);
  md = md.replace(/<h5\b[^>]*>([\s\S]*?)<\/h5>/gi, (_, content) => `##### ${content.replace(/<[^>]+>/g, '').trim()}\n`);
  md = md.replace(/<h6\b[^>]*>([\s\S]*?)<\/h6>/gi, (_, content) => `###### ${content.replace(/<[^>]+>/g, '').trim()}\n`);

  // Convert line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Convert blockquotes
  md = md.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    const lines = content.replace(/<[^>]+>/g, '').trim().split('\n');
    return lines.map((line: string) => `> ${line}`).join('\n') + '\n';
  });

  // Convert unordered lists
  md = md.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_, content) => {
    return content.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_: string, item: string) => {
      return `- ${item.replace(/<[^>]+>/g, '').trim()}\n`;
    });
  });

  // Convert ordered lists
  let listCounter = 0;
  md = md.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_, content) => {
    listCounter = 0;
    return content.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_: string, item: string) => {
      listCounter++;
      return `${listCounter}. ${item.replace(/<[^>]+>/g, '').trim()}\n`;
    });
  });

  // Convert horizontal rules
  md = md.replace(/<hr\b[^>]*\/?>/gi, '\n---\n');

  // Convert paragraphs - extract content and add newlines
  md = md.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_, content) => {
    const clean = content.replace(/<[^>]+>/g, '').trim();
    return clean ? clean + '\n\n' : '';
  });

  // Convert divs to newlines
  md = md.replace(/<div\b[^>]*>([\s\S]*?)<\/div>/gi, '$1\n');

  // Remove any remaining HTML tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  md = md.replace(/&amp;/g, '&');
  md = md.replace(/&lt;/g, '<');
  md = md.replace(/&gt;/g, '>');
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, ' ');
  md = md.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));

  // Clean up whitespace
  md = md.replace(/[ \t]+$/gm, ''); // Trailing spaces
  md = md.replace(/\n{3,}/g, '\n\n'); // Multiple newlines
  md = md.trim();

  return md;
}

export async function convertCell(
  noteId: string,
  cellId: string,
  newType: CellType
): Promise<void> {
  // Get current cell to check its type and data
  const cells = await getCellsByNote(noteId);
  const currentCell = cells.find(c => c.id === cellId);
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

  const notes: Note[] = [];
  for (const row of rows) {
    const cells = await getCellsByNote(row.id);
    const tags = await getTagsForNote(row.id);
    notes.push(rowToNote(row, cells, tags));
  }
  return notes;
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

  // Combine all cell content for search
  const content = note.cells.map(cell => cell.data).join('\n');

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

  // Prepare FTS5 query
  const ftsQuery = query
    .split(/\s+/)
    .map(term => `"${term}"*`)
    .join(' OR ');

  const rows = await getDb().select<{ note_id: string }[]>(
    `SELECT note_id FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank`,
    [ftsQuery]
  );

  const notes: Note[] = [];
  for (const row of rows) {
    const note = await getNote(row.note_id);
    if (note && !note.isTrashed) {
      notes.push(note);
    }
  }
  return notes;
}

// ==================== INITIALIZATION ====================

export async function ensureInboxNotebook(): Promise<Notebook> {
  const notebooks = await getAllNotebooks();
  let inbox = notebooks.find(n => n.name === 'Inbox');

  if (!inbox) {
    inbox = await createNotebook('Inbox');
  }

  return inbox;
}
