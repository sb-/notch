import { test, expect, describe, mock, beforeEach } from 'bun:test';
import type { Note } from '../types';
import * as realDb from './database';

// The list `db.searchNotes` will return for any query. Set per-test below so we
// can exercise searchNotes' filtering in isolation from the real (Tauri/SQLite)
// database.
let dbResults: Note[] = [];

// bun:test runs every test file in one process and mock.module is process-wide,
// so we spread the real module (keeping every other export intact for other
// files) and re-install in beforeEach so this file's mock wins while its tests
// run, regardless of load order.
function installMock() {
  mock.module('./database', () => ({
    ...realDb,
    searchNotes: async (_query: string) => dbResults,
  }));
}
installMock();

// Imported after the mock is registered so searchNotes binds to the stub.
const { searchNotes } = await import('./search');

let noteId = 0;
function note(overrides: Partial<Note> = {}): Note {
  return {
    id: `n${noteId++}`,
    notebookId: 'nb1',
    title: 'Note',
    cells: [],
    tags: [],
    isFavorite: false,
    isTrashed: false,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('searchNotes', () => {
  beforeEach(() => {
    dbResults = [];
    installMock();
  });

  test('returns an empty array for a blank query without hitting the db', async () => {
    // dbResults is non-empty to prove the query never reaches the db layer.
    dbResults = [note()];
    expect(await searchNotes('')).toEqual([]);
    expect(await searchNotes('   ')).toEqual([]);
  });

  test('returns all matches when no options are given', async () => {
    dbResults = [note({ id: 'a' }), note({ id: 'b' })];
    const results = await searchNotes('anything');
    expect(results.map(n => n.id)).toEqual(['a', 'b']);
  });

  test('filters to a single notebook when notebookId is given', async () => {
    dbResults = [
      note({ id: 'keep', notebookId: 'nb1' }),
      note({ id: 'drop', notebookId: 'nb2' }),
    ];
    const results = await searchNotes('x', { notebookId: 'nb1' });
    expect(results.map(n => n.id)).toEqual(['keep']);
  });

  test('excludes trashed notes by default', async () => {
    dbResults = [
      note({ id: 'live', isTrashed: false }),
      note({ id: 'trashed', isTrashed: true }),
    ];
    const results = await searchNotes('x');
    expect(results.map(n => n.id)).toEqual(['live']);
  });

  test('includes trashed notes when includeTrash is true', async () => {
    dbResults = [
      note({ id: 'live', isTrashed: false }),
      note({ id: 'trashed', isTrashed: true }),
    ];
    const results = await searchNotes('x', { includeTrash: true });
    expect(results.map(n => n.id)).toEqual(['live', 'trashed']);
  });

  test('caps the result set at the given limit', async () => {
    dbResults = [note({ id: 'a' }), note({ id: 'b' }), note({ id: 'c' })];
    const results = await searchNotes('x', { limit: 2 });
    expect(results.map(n => n.id)).toEqual(['a', 'b']);
  });

  test('applies notebook, trash, and limit filters together', async () => {
    dbResults = [
      note({ id: 'a', notebookId: 'nb1', isTrashed: false }),
      note({ id: 'trashed', notebookId: 'nb1', isTrashed: true }),
      note({ id: 'other', notebookId: 'nb2', isTrashed: false }),
      note({ id: 'b', notebookId: 'nb1', isTrashed: false }),
      note({ id: 'c', notebookId: 'nb1', isTrashed: false }),
    ];
    const results = await searchNotes('x', { notebookId: 'nb1', limit: 2 });
    // 'trashed' and 'other' are filtered out before the limit is applied.
    expect(results.map(n => n.id)).toEqual(['a', 'b']);
  });
});
