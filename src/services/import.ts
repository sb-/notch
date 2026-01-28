import { readDir, readTextFile } from '@tauri-apps/plugin-fs';
import type { CellType, DiagramType } from '../types';
import * as db from './database';

// Quiver data format types
interface QuiverNotebookMeta {
  name: string;
  uuid: string;
  children?: string[]; // UUIDs of child notebooks (for nested notebooks)
}

interface QuiverNoteMeta {
  title: string;
  uuid: string;
  created_at: number;
  updated_at: number;
  tags: string[];
}

interface QuiverCellData {
  type: 'text' | 'code' | 'markdown' | 'latex' | 'diagram';
  language?: string;
  diagramType?: string;
  data: string;
}

interface QuiverNoteContent {
  title: string;
  cells: QuiverCellData[];
}

export interface ImportProgress {
  phase: 'scanning' | 'importing';
  currentNotebook?: string;
  currentNote?: string;
  notebooksTotal: number;
  notebooksCompleted: number;
  notesTotal: number;
  notesCompleted: number;
}

export interface ImportError {
  noteTitle: string;
  notePath: string;
  error: string;
}

export interface ImportResult {
  notebooks: number;
  notebooksSkipped: number;
  notesImported: number;
  notesFailed: number;
  errors: ImportError[];
}

export interface DuplicateInfo {
  notebookNames: string[];
  totalNotebooks: number;
}

type ProgressCallback = (progress: ImportProgress) => void;

/**
 * Scan a Quiver library for potential duplicate notebooks
 */
export async function scanForDuplicates(libraryPath: string): Promise<DuplicateInfo> {
  const existingNotebooks = await db.getAllNotebooks();
  const existingNames = new Set(existingNotebooks.map(n => n.name.toLowerCase()));

  const duplicateNames: string[] = [];
  let totalNotebooks = 0;

  try {
    const entries = await readDir(libraryPath);

    for (const entry of entries) {
      if (entry.isDirectory && entry.name.endsWith('.qvnotebook')) {
        totalNotebooks++;
        try {
          const metaPath = `${libraryPath}/${entry.name}/meta.json`;
          const metaContent = await readTextFile(metaPath);
          const meta: QuiverNotebookMeta = JSON.parse(metaContent);

          if (existingNames.has(meta.name.toLowerCase())) {
            duplicateNames.push(meta.name);
          }
        } catch {
          // Skip notebooks we can't read
        }
      }
    }
  } catch {
    // Return empty if we can't read the library
  }

  return {
    notebookNames: duplicateNames,
    totalNotebooks,
  };
}

/**
 * Sanitize JSON string by fixing invalid escape sequences
 */
function sanitizeJsonString(str: string): string {
  // Fix invalid hex escapes like \x00 - JSON only supports \uXXXX
  return str.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => {
    return '\\u00' + hex;
  });
}

// Map Quiver cell types to our types
function mapCellType(quiverType: string): CellType {
  switch (quiverType) {
    case 'text':
      return 'text';
    case 'code':
      return 'code';
    case 'markdown':
      return 'markdown';
    case 'latex':
      return 'latex';
    case 'diagram':
      return 'diagram';
    default:
      return 'text';
  }
}

function mapDiagramType(quiverType?: string): DiagramType | undefined {
  switch (quiverType) {
    case 'sequence':
      return 'sequence';
    case 'flow':
    case 'flowchart':
      return 'flow';
    default:
      return undefined;
  }
}

export interface ImportOptions {
  skipDuplicates?: boolean;
  onProgress?: ProgressCallback;
}

// Info collected during notebook scanning phase
interface NotebookScanInfo {
  path: string;
  meta: QuiverNotebookMeta;
  parentUuid: string | null;
}

/**
 * Import a Quiver library (.qvlibrary directory)
 */
export async function importQuiverLibrary(
  libraryPath: string,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const { skipDuplicates = false, onProgress } = options;

  const result: ImportResult = {
    notebooks: 0,
    notebooksSkipped: 0,
    notesImported: 0,
    notesFailed: 0,
    errors: [],
  };

  const progress: ImportProgress = {
    phase: 'scanning',
    notebooksTotal: 0,
    notebooksCompleted: 0,
    notesTotal: 0,
    notesCompleted: 0,
  };

  // Get existing notebook names for duplicate checking
  const existingNotebooks = await db.getAllNotebooks();
  const existingNames = new Set(existingNotebooks.map(n => n.name.toLowerCase()));

  try {
    // Read the library directory
    const entries = await readDir(libraryPath);

    // Find all .qvnotebook directories
    const notebookEntries = entries.filter(
      entry => entry.isDirectory && entry.name.endsWith('.qvnotebook')
    );

    progress.notebooksTotal = notebookEntries.length;
    onProgress?.(progress);

    // First pass: scan all notebooks and build parent-child relationships
    const notebooksByUuid = new Map<string, NotebookScanInfo>();
    const childToParent = new Map<string, string>(); // child UUID -> parent UUID

    for (const entry of notebookEntries) {
      const notebookPath = `${libraryPath}/${entry.name}`;
      try {
        const metaContent = await readTextFile(`${notebookPath}/meta.json`);
        const meta: QuiverNotebookMeta = JSON.parse(metaContent);
        notebooksByUuid.set(meta.uuid, { path: notebookPath, meta, parentUuid: null });

        // Track children references
        if (meta.children && meta.children.length > 0) {
          for (const childUuid of meta.children) {
            childToParent.set(childUuid, meta.uuid);
          }
        }
      } catch {
        // Skip notebooks we can't read metadata for
      }
    }

    // Set parent UUIDs based on the collected children relationships
    for (const [childUuid, parentUuid] of childToParent.entries()) {
      const childInfo = notebooksByUuid.get(childUuid);
      if (childInfo) {
        childInfo.parentUuid = parentUuid;
      }
    }

    // Sort notebooks so parents are imported before children (topological sort)
    const sortedNotebooks: NotebookScanInfo[] = [];
    const visited = new Set<string>();

    const visit = (uuid: string) => {
      if (visited.has(uuid)) return;
      const info = notebooksByUuid.get(uuid);
      if (!info) return;

      // Visit parent first if it exists
      if (info.parentUuid && notebooksByUuid.has(info.parentUuid)) {
        visit(info.parentUuid);
      }

      visited.add(uuid);
      sortedNotebooks.push(info);
    };

    for (const uuid of notebooksByUuid.keys()) {
      visit(uuid);
    }

    progress.phase = 'importing';
    onProgress?.(progress);

    // Map Quiver UUIDs to created notebook IDs
    const uuidToNotebookId = new Map<string, string>();

    // Second pass: import notebooks in order (parents before children)
    for (const info of sortedNotebooks) {
      try {
        progress.currentNotebook = info.meta.name;
        onProgress?.(progress);

        // Skip if duplicate and skipDuplicates is enabled
        if (skipDuplicates && existingNames.has(info.meta.name.toLowerCase())) {
          result.notebooksSkipped++;
          progress.notebooksCompleted++;
          onProgress?.(progress);
          continue;
        }

        // Determine parent notebook ID if this is a nested notebook
        let parentId: string | undefined;
        if (info.parentUuid) {
          parentId = uuidToNotebookId.get(info.parentUuid);
        }

        const notebookResult = await importQuiverNotebook(info.path, parentId, (noteProgress) => {
          progress.currentNote = noteProgress.currentNote;
          progress.notesTotal = progress.notesCompleted + noteProgress.notesTotal;
          onProgress?.(progress);
        });

        // Store the mapping from Quiver UUID to our notebook ID
        if (notebookResult.notebookId) {
          uuidToNotebookId.set(info.meta.uuid, notebookResult.notebookId);
        }

        result.notebooks++;
        result.notesImported += notebookResult.notesImported;
        result.notesFailed += notebookResult.notesFailed;
        result.errors.push(...notebookResult.errors);
        progress.notebooksCompleted++;
        progress.notesCompleted += notebookResult.notesImported + notebookResult.notesFailed;
        onProgress?.(progress);
      } catch (err) {
        result.errors.push({
          noteTitle: info.meta.name,
          notePath: info.path,
          error: `Failed to import notebook: ${err}`,
        });
      }
    }
  } catch (err) {
    result.errors.push({
      noteTitle: 'Library',
      notePath: libraryPath,
      error: `Failed to read library: ${err}`,
    });
  }

  return result;
}

interface NotebookProgressCallback {
  (progress: { currentNote?: string; notesTotal: number; notesCompleted: number }): void;
}

/**
 * Import a single Quiver notebook (.qvnotebook directory)
 */
async function importQuiverNotebook(
  notebookPath: string,
  parentId?: string,
  onProgress?: NotebookProgressCallback
): Promise<{
  notebookId?: string;
  notesImported: number;
  notesFailed: number;
  errors: ImportError[];
}> {
  const result: {
    notebookId?: string;
    notesImported: number;
    notesFailed: number;
    errors: ImportError[];
  } = {
    notesImported: 0,
    notesFailed: 0,
    errors: [],
  };

  try {
    // Read notebook meta.json
    const metaPath = `${notebookPath}/meta.json`;
    const metaContent = await readTextFile(metaPath);
    const meta: QuiverNotebookMeta = JSON.parse(metaContent);

    // Create the notebook in our database with optional parent
    const notebook = await db.createNotebook(meta.name, parentId);
    result.notebookId = notebook.id;

    // Read all .qvnote directories
    const entries = await readDir(notebookPath);
    const noteEntries = entries.filter(
      entry => entry.isDirectory && entry.name.endsWith('.qvnote')
    );

    for (let i = 0; i < noteEntries.length; i++) {
      const entry = noteEntries[i];
      const notePath = `${notebookPath}/${entry.name}`;
      let noteTitle = entry.name;

      try {
        // Try to get the note title for progress/errors
        try {
          const noteMetaContent = await readTextFile(`${notePath}/meta.json`);
          const noteMeta: QuiverNoteMeta = JSON.parse(noteMetaContent);
          noteTitle = noteMeta.title || entry.name;
        } catch {
          // Use entry name if meta fails
        }

        onProgress?.({
          currentNote: noteTitle,
          notesTotal: noteEntries.length,
          notesCompleted: i,
        });

        await importQuiverNote(notePath, notebook.id);
        result.notesImported++;
      } catch (err) {
        result.notesFailed++;
        result.errors.push({
          noteTitle,
          notePath: entry.name,
          error: String(err),
        });
      }
    }
  } catch (err) {
    result.errors.push({
      noteTitle: 'Notebook',
      notePath: notebookPath,
      error: `Failed to read notebook metadata: ${err}`,
    });
  }

  return result;
}

/**
 * Import a single Quiver note (.qvnote directory)
 */
async function importQuiverNote(notePath: string, notebookId: string): Promise<void> {
  // Read note meta.json
  const metaPath = `${notePath}/meta.json`;
  const metaContent = await readTextFile(metaPath);
  const meta: QuiverNoteMeta = JSON.parse(sanitizeJsonString(metaContent));

  // Read note content.json
  const contentPath = `${notePath}/content.json`;
  const contentStr = await readTextFile(contentPath);
  const content: QuiverNoteContent = JSON.parse(sanitizeJsonString(contentStr));

  // Create the note with the original Quiver UUID for cross-reference links
  const note = await db.createNote(notebookId, content.title || meta.title, meta.uuid);

  // Delete the default cell that was created
  const existingCells = await db.getCellsByNote(note.id);
  for (const cell of existingCells) {
    await db.deleteCell(note.id, cell.id);
  }

  // Create cells from Quiver content
  for (let i = 0; i < content.cells.length; i++) {
    const quiverCell = content.cells[i];
    const cellType = mapCellType(quiverCell.type);

    const cell = await db.createCell(note.id, cellType);

    // Update cell with data
    await db.updateCell(note.id, cell.id, {
      data: quiverCell.data,
      language: quiverCell.language,
      diagramType: mapDiagramType(quiverCell.diagramType),
    });
  }

  // Handle tags
  if (meta.tags && meta.tags.length > 0) {
    for (const tagName of meta.tags) {
      // Create or find tag
      const tags = await db.getAllTags();
      let tag = tags.find(t => t.name === tagName);
      if (!tag) {
        tag = await db.createTag(tagName);
      }
      await db.addTagToNote(note.id, tag.id);
    }
  }

  // Update timestamps
  await db.updateNote(note.id, {
    createdAt: meta.created_at * 1000, // Quiver uses seconds
    updatedAt: meta.updated_at * 1000,
  });

  // Import resources if they exist
  try {
    const resourcesPath = `${notePath}/resources`;
    const resources = await readDir(resourcesPath);
    for (const resource of resources) {
      if (resource.isFile) {
        // Resource import would go here
        // For now, we skip binary resources
      }
    }
  } catch {
    // Resources directory may not exist
  }
}

/**
 * Import a single markdown file as a note
 */
export async function importMarkdownFile(
  filePath: string,
  notebookId: string
): Promise<void> {
  const content = await readTextFile(filePath);

  // Extract title from first heading or filename
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const fileName = filePath.split('/').pop() || 'Untitled';
  const title = titleMatch ? titleMatch[1] : fileName.replace(/\.md$/, '');

  // Create note
  const note = await db.createNote(notebookId, title);

  // Delete default cell
  const existingCells = await db.getCellsByNote(note.id);
  for (const cell of existingCells) {
    await db.deleteCell(note.id, cell.id);
  }

  // Create a single markdown cell with the content
  const cell = await db.createCell(note.id, 'markdown');
  await db.updateCell(note.id, cell.id, { data: content });
}
