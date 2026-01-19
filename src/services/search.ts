import * as db from './database';
import type { Note } from '../types';

export interface SearchOptions {
  notebookId?: string;
  includeTrash?: boolean;
  limit?: number;
}

/**
 * Search notes by full-text query
 */
export async function searchNotes(
  query: string,
  options: SearchOptions = {}
): Promise<Note[]> {
  if (!query.trim()) {
    return [];
  }

  let results = await db.searchNotes(query);

  // Filter by notebook if specified
  if (options.notebookId) {
    results = results.filter(note => note.notebookId === options.notebookId);
  }

  // Filter trash unless explicitly included
  if (!options.includeTrash) {
    results = results.filter(note => !note.isTrashed);
  }

  // Apply limit
  if (options.limit && options.limit > 0) {
    results = results.slice(0, options.limit);
  }

  return results;
}

/**
 * Search within a specific note
 */
export function searchWithinNote(
  note: Note,
  query: string
): { cellIndex: number; matches: { start: number; end: number }[] }[] {
  const results: { cellIndex: number; matches: { start: number; end: number }[] }[] = [];
  const lowerQuery = query.toLowerCase();

  for (let i = 0; i < note.cells.length; i++) {
    const cell = note.cells[i];
    const lowerData = cell.data.toLowerCase();
    const matches: { start: number; end: number }[] = [];

    let index = 0;
    while ((index = lowerData.indexOf(lowerQuery, index)) !== -1) {
      matches.push({ start: index, end: index + query.length });
      index += 1;
    }

    if (matches.length > 0) {
      results.push({ cellIndex: i, matches });
    }
  }

  return results;
}

/**
 * Highlight search matches in text
 */
export function highlightMatches(
  text: string,
  query: string,
  highlightClass = 'search-highlight'
): string {
  if (!query.trim()) return text;

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');

  return text.replace(regex, `<span class="${highlightClass}">$1</span>`);
}

/**
 * Get search suggestions based on existing content
 */
export async function getSearchSuggestions(
  prefix: string,
  limit = 5
): Promise<string[]> {
  // Get all notes and extract unique words that match the prefix
  const notes = await db.getAllNotes();
  const wordSet = new Set<string>();

  const lowerPrefix = prefix.toLowerCase();

  for (const note of notes) {
    // Check title
    const titleWords = note.title.split(/\s+/);
    for (const word of titleWords) {
      if (word.toLowerCase().startsWith(lowerPrefix)) {
        wordSet.add(word);
      }
    }

    // Check cell content
    for (const cell of note.cells) {
      const words = cell.data.split(/\s+/);
      for (const word of words) {
        const cleanWord = word.replace(/[^\w]/g, '');
        if (cleanWord.toLowerCase().startsWith(lowerPrefix) && cleanWord.length > 2) {
          wordSet.add(cleanWord);
        }
      }
    }
  }

  return Array.from(wordSet)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit);
}
