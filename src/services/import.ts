import { readDir, readTextFile } from '@tauri-apps/plugin-fs';
import type { CellType, DiagramType } from '../types';
import * as db from './database';

// Quiver data format types
interface QuiverNotebookMeta {
  name: string;
  uuid: string;
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

/**
 * Import a Quiver library (.qvlibrary directory)
 */
export async function importQuiverLibrary(libraryPath: string): Promise<{
  notebooks: number;
  notes: number;
  errors: string[];
}> {
  const result = {
    notebooks: 0,
    notes: 0,
    errors: [] as string[],
  };

  try {
    // Read the library directory
    const entries = await readDir(libraryPath);

    // Find all .qvnotebook directories
    for (const entry of entries) {
      if (entry.isDirectory && entry.name.endsWith('.qvnotebook')) {
        try {
          const notebookPath = `${libraryPath}/${entry.name}`;
          const notebookResult = await importQuiverNotebook(notebookPath);
          result.notebooks++;
          result.notes += notebookResult.notes;
          result.errors.push(...notebookResult.errors);
        } catch (err) {
          result.errors.push(`Failed to import notebook ${entry.name}: ${err}`);
        }
      }
    }
  } catch (err) {
    result.errors.push(`Failed to read library: ${err}`);
  }

  return result;
}

/**
 * Import a single Quiver notebook (.qvnotebook directory)
 */
async function importQuiverNotebook(notebookPath: string): Promise<{
  notes: number;
  errors: string[];
}> {
  const result = {
    notes: 0,
    errors: [] as string[],
  };

  try {
    // Read notebook meta.json
    const metaPath = `${notebookPath}/meta.json`;
    const metaContent = await readTextFile(metaPath);
    const meta: QuiverNotebookMeta = JSON.parse(metaContent);

    // Create the notebook in our database
    const notebook = await db.createNotebook(meta.name);

    // Read all .qvnote directories
    const entries = await readDir(notebookPath);
    for (const entry of entries) {
      if (entry.isDirectory && entry.name.endsWith('.qvnote')) {
        try {
          const notePath = `${notebookPath}/${entry.name}`;
          await importQuiverNote(notePath, notebook.id);
          result.notes++;
        } catch (err) {
          result.errors.push(`Failed to import note ${entry.name}: ${err}`);
        }
      }
    }
  } catch (err) {
    result.errors.push(`Failed to read notebook metadata: ${err}`);
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
  const meta: QuiverNoteMeta = JSON.parse(metaContent);

  // Read note content.json
  const contentPath = `${notePath}/content.json`;
  const contentStr = await readTextFile(contentPath);
  const content: QuiverNoteContent = JSON.parse(contentStr);

  // Create the note
  const note = await db.createNote(notebookId, content.title || meta.title);

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
