import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { v4 as uuid } from 'uuid';
import type { Cell, Resource } from '../types';
import * as db from './database';

// Plain text stays useful in other apps; matching in-app pastes retain the cell
// type, language and independent copies of its embedded resources.
let clipboard: { text: string; cell: Cell; resources: Resource[] } | null = null;
export async function copyCell(noteId: string, cell: Cell): Promise<void> {
  const resources = (await db.getResourcesByNote(noteId)).filter(resource => cell.data.includes(resource.id));
  await writeText(cell.data);
  clipboard = { text: cell.data, cell: { ...cell }, resources };
}
export async function readCell(noteId: string): Promise<Cell | null> {
  const text = await readText();
  if (!text && !clipboard) return null;
  if (!clipboard || text !== clipboard.text) return { id: uuid(), type: 'markdown', data: text, sortOrder: 0 };
  let data = clipboard.cell.data;
  for (const resource of clipboard.resources) {
    const copy = await db.createResource(noteId, resource.filename, resource.mimeType, resource.data);
    data = data.replaceAll(resource.id, copy.id);
  }
  return { ...clipboard.cell, id: uuid(), data };
}
