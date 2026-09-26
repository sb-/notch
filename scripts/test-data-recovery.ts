import { Database as SQLite } from 'bun:sqlite';
import { expect, mock } from 'bun:test';

// Use the real app database and store with only the native SQL transport replaced.
// A separate process keeps the other suites' global service mocks out of this test.
let connection: SQLite;
const databases = new Map<string, SQLite>();
mock.module('@tauri-apps/plugin-sql', () => ({
  default: { load: async (path: string) => {
    connection = databases.get(path) ?? new SQLite(':memory:');
    connection.exec('PRAGMA foreign_keys=ON');
    databases.set(path, connection);
    const current = connection;
    return {
      execute: async (sql: string, values: any[] = []) => current.query(sql).run(...values),
      select: async (sql: string, values: any[] = []) => current.query(sql).all(...values),
      close: async () => {},
    };
  } },
}));
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
}, configurable: true });

const db = await import('../src/services/database');
const { useStore } = await import('../src/store');
const { visibleNotes } = await import('../src/utils/noteSelection');

await useStore.getState().loadData('sqlite:recovery');
const inbox = (await db.getAllNotebooks()).find(n => n.name === 'Inbox')!;
const parent = await useStore.getState().createNotebook('Parent');
const child = await useStore.getState().createNotebook('Child', parent.id);
const live = await useStore.getState().createNote(child.id, 'Live note');
const alreadyTrashed = await useStore.getState().createNote(parent.id, 'Previously trashed');
const attachment = await db.createResource(live.id, 'image.png', 'image/png', 'aW1hZ2U=');
await useStore.getState().updateCell(live.id, live.cells[0].id, { data: `![image](notch-resource://${attachment.id})` });
const tag = await useStore.getState().createTag('keep-me');
await useStore.getState().addTagToNote(live.id, tag.id);
await useStore.getState().deleteNote(alreadyTrashed.id);
await useStore.getState().selectNotebook(parent.id);
await useStore.getState().deleteNotebook(parent.id);
expect(await db.getNotebook(parent.id)).toBeNull();
expect(await db.getNotebook(child.id)).toBeNull();
expect(useStore.getState().notebooks.map(n => n.id)).toEqual([inbox.id]);
for (const note of await db.getAllNotes(true)) {
  expect(note.isTrashed).toBe(true);
  expect(note.notebookId).toBe(inbox.id);
}
expect(await db.getResourcesByNote(live.id)).toEqual([attachment]);
expect((await db.getNote(live.id))!.tags).toEqual(['keep-me']);
expect(useStore.getState().selectedCollection).toBe('trash');
expect(visibleNotes(useStore.getState())).toHaveLength(2);
await useStore.getState().loadData('sqlite:recovery');
expect(visibleNotes(useStore.getState())).toHaveLength(2);
await useStore.getState().restoreNote(live.id);
expect((await db.getNote(live.id))!.isTrashed).toBe(false);
expect(useStore.getState().selectedNoteId).toBe(alreadyTrashed.id);
expect(visibleNotes(useStore.getState())).toHaveLength(1);
await expect(db.deleteNotebook(inbox.id)).rejects.toThrow('Inbox cannot be deleted');
expect((await db.getNote(live.id))!.cells[0].data).toContain(attachment.id);

// Inject a trigger failure halfway through subtree deletion; no earlier note move
// or notebook deletion may survive the failed SQL statement.
const failParent = await db.createNotebook('Rollback parent');
const failChild = await db.createNotebook('Rollback child', failParent.id);
const failNote = await db.createNote(failParent.id, 'Must stay live');
connection!.exec(`CREATE TRIGGER fail_notebook_delete BEFORE DELETE ON notebooks
  WHEN OLD.name = 'Rollback child' BEGIN SELECT RAISE(ABORT, 'test failure'); END;`);
await expect(db.deleteNotebook(failParent.id)).rejects.toThrow('test failure');
expect(await db.getNotebook(failParent.id)).not.toBeNull();
expect(await db.getNotebook(failChild.id)).not.toBeNull();
expect((await db.getNote(failNote.id))!.isTrashed).toBe(false);
connection!.exec('DROP TRIGGER fail_notebook_delete');
console.log('PASS notebook removal preserves nested/trashed notes, attachments and tags; failure rolls back');

await useStore.getState().selectCollection('all');
await useStore.getState().selectNote(live.id);
await useStore.getState().deleteNote(live.id);
expect(useStore.getState().selectedNoteId).not.toBe(live.id);
expect(useStore.getState().selectedNoteId).not.toBe(alreadyTrashed.id);
await useStore.getState().restoreNote(live.id);
const duplicate = await useStore.getState().duplicateNote(live.id);
const copiedResources = await db.getResourcesByNote(duplicate.id);
// Navigation follows the displayed sort, not the storage/insertion order.
useStore.getState().setSortBy('title');
useStore.getState().setSortOrder('asc');
await useStore.getState().selectNotebook(inbox.id);
expect(useStore.getState().selectedNoteId).toBe(live.id);
await useStore.getState().selectTag(tag.id);
expect(useStore.getState().selectedNoteId).toBe(live.id);
await useStore.getState().selectCollection('all');
expect(useStore.getState().selectedNoteId).toBe(live.id);
expect(duplicate.title).toBe('Live note Copy');
expect(duplicate.tags).toEqual(['keep-me']);
expect(copiedResources).toHaveLength(1);
expect(copiedResources[0].id).not.toBe(attachment.id);
expect(copiedResources[0].data).toBe(attachment.data);
expect(duplicate.cells[0].data).toContain(copiedResources[0].id);
expect(duplicate.cells[0].data).not.toContain(attachment.id);
await db.deleteNote(live.id, true);
expect((await db.getResourcesByNote(duplicate.id))[0].data).toBe(attachment.data);
console.log('PASS note trash/restore selection and independent duplication of image resources');

useStore.getState().setLayoutMode('double');
useStore.getState().setEditorViewMode('editor');
useStore.getState().setSortBy('title');
useStore.getState().setSortOrder('asc');
await useStore.getState().selectTag(tag.id);
await useStore.getState().selectNote(duplicate.id);
await useStore.getState().loadData('sqlite:recovery');
expect(useStore.getState().selectedTagId).toBe(tag.id);
expect(useStore.getState().selectedNoteId).toBe(duplicate.id);
expect(useStore.getState().layoutMode).toBe('double');
expect(useStore.getState().editorViewMode).toBe('editor');
expect(useStore.getState().sortOrder).toBe('asc');
await useStore.getState().loadData('sqlite:other');
expect(useStore.getState().selectedTagId).toBeNull();
await useStore.getState().loadData('sqlite:recovery');
expect(useStore.getState().selectedTagId).toBe(tag.id);
console.log('PASS view and valid note/tag selection persist independently per library');

const trashedImageNote = await db.duplicateNote(duplicate.id);
await db.deleteNote(trashedImageNote.id);
await db.updateNote(duplicate.id, { isFavorite: true });
const { exportLibraryToJSON } = await import('../src/services/export');
const { parseLibraryBackup } = await import('../src/services/backup');
const snapshot = parseLibraryBackup(await exportLibraryToJSON());
expect(snapshot.notes.find(note => note.id === trashedImageNote.id)!.isTrashed).toBe(true);
expect(snapshot.resources.some(resource => resource.noteId === trashedImageNote.id)).toBe(true);
// Reverse parent order to validate that batch restoration handles hierarchy FKs.
snapshot.notebooks.reverse();
await db.initDatabase('sqlite:restored');
await db.restoreLibrarySnapshot(snapshot);
expect((await db.getAllNotes(true)).length).toBe(snapshot.notes.length);
expect((await db.getTrashedNotes()).length).toBe(2);
expect(await db.getResourcesByNote(duplicate.id)).toEqual(snapshot.resources.filter(resource => resource.noteId === duplicate.id));
expect((await db.getResourcesByNote(trashedImageNote.id))[0].data).toBe(attachment.data);
expect((await db.getNote(duplicate.id))!.tags).toEqual(['keep-me']);
expect((await db.getNote(duplicate.id))!.isFavorite).toBe(true);
expect((await db.searchNotes('Live')).map(n => n.id)).toContain(duplicate.id);
await expect(db.restoreLibrarySnapshot(snapshot)).rejects.toThrow('empty library');
expect((await db.getAllNotes(true)).length).toBe(snapshot.notes.length);
await db.initDatabase('sqlite:failedRestore');
const invalid = { ...snapshot, resources: [...snapshot.resources, { ...snapshot.resources[0], id: 'orphan', noteId: 'missing' }] };
await expect(db.restoreLibrarySnapshot(invalid)).rejects.toThrow();
expect(await db.getAllNotes(true)).toEqual([]);
expect(await db.getAllNotebooks()).toEqual([]);
expect(await db.getAllTags()).toEqual([]);
await db.restoreLibrarySnapshot(snapshot);
expect((await db.getAllNotes(true)).length).toBe(snapshot.notes.length);
console.log('PASS atomic backup restore with hierarchy, Trash, tags, image bytes, search, and failure rollback');

// Exercise the importer against the same real SQLite transport, including an
// attachment read failure that must not leave a partially imported note behind.
let failResourceRead = false;
const source = '/fixture.qvlibrary';
const book = `${source}/Tutorial.qvnotebook`;
const sourceNote = `${book}/image.qvnote`;
const entry = (name: string, isDirectory = false) => ({ name, isDirectory, isFile: !isDirectory });
const dirs: Record<string, ReturnType<typeof entry>[]> = {
  [source]: [entry('Tutorial.qvnotebook', true)],
  [book]: [entry('meta.json'), entry('image.qvnote', true)],
  [sourceNote]: [entry('meta.json'), entry('content.json'), entry('resources', true)],
  [`${sourceNote}/resources`]: [entry('image.png')],
};
const files: Record<string, string> = {
  [`${book}/meta.json`]: JSON.stringify({ name: 'Images', uuid: 'book-original' }),
  [`${sourceNote}/meta.json`]: JSON.stringify({ title: 'Image sample', uuid: 'note-original', tags: ['imported'], created_at: 1, updated_at: 2 }),
  [`${sourceNote}/content.json`]: JSON.stringify({ title: 'Image sample', cells: [{ type: 'markdown', data: '![Sample](quiver-image-url/image.png)' }] }),
};
mock.module('@tauri-apps/plugin-fs', () => ({
  readDir: async (path: string) => { if (!dirs[path]) throw new Error(`ENOENT ${path}`); return dirs[path]; },
  readTextFile: async (path: string) => { if (!files[path]) throw new Error(`ENOENT ${path}`); return files[path]; },
  readFile: async () => { if (failResourceRead) throw new Error('Attachment access denied'); return new TextEncoder().encode('image'); },
}));
const { importQuiverLibrary, summarizeImport } = await import('../src/services/import');
await db.initDatabase('sqlite:importSuccess');
const imported = await importQuiverLibrary(source);
expect(imported.notesImported).toBe(1);
expect(imported.errors).toEqual([]);
const importedNote = (await db.getAllNotes())[0];
const importedResources = await db.getResourcesByNote(importedNote.id);
expect(importedResources[0].data).toBe('aW1hZ2U=');
expect(importedNote.cells[0].data).toBe(`![Sample](notch-resource://${importedResources[0].id})`);
expect(importedNote.tags).toEqual(['imported']);
expect(importedNote.sourceUuid).toBe('note-original');
await db.initDatabase('sqlite:importFailure');
failResourceRead = true;
const failedImport = await importQuiverLibrary(source);
expect(failedImport.notesFailed).toBe(1);
expect(failedImport.notesImported).toBe(0);
expect(summarizeImport(failedImport).text).toContain('Attachment access denied');
expect(await db.getAllNotes(true)).toEqual([]);
expect(connection!.query('SELECT * FROM resources').all()).toEqual([]);
console.log('PASS Quiver images import intact and attachment failures report diagnostics without partial notes');

// A native insertion must expose a writable cell before the SQL round trips
// finish. Immediate edits and a second insertion must persist in the same order.
await useStore.getState().loadData('sqlite:rapid-insertion');
const rapid = await useStore.getState().createNote(useStore.getState().notebooks.find(n => n.name === 'Inbox')!.id, 'Rapid input');
const firstInsertion = useStore.getState().addCell(rapid.id, 'code', rapid.cells[0].id);
const firstId = useStore.getState().focusedCellId!;
expect(firstId).not.toBe(rapid.cells[0].id);
expect(useStore.getState().notes.find(n => n.id === rapid.id)!.cells).toHaveLength(2);
const firstEdit = useStore.getState().updateCell(rapid.id, firstId, { data: 'immediate first' });
const secondInsertion = useStore.getState().addCell(rapid.id, 'code', firstId);
const secondId = useStore.getState().focusedCellId!;
const secondEdit = useStore.getState().updateCell(rapid.id, secondId, { data: 'immediate second' });
await Promise.all([firstInsertion, firstEdit, secondInsertion, secondEdit]);
const savedRapid = (await db.getNote(rapid.id))!;
expect(savedRapid.cells.map(c => c.data)).toEqual(['', 'immediate first', 'immediate second']);
expect(savedRapid.cells.map(c => c.sortOrder)).toEqual([0, 1, 2]);
console.log('PASS immediate insertion and rapid edits persist in order');

// Exercise query quoting through the real service and FTS5 tokenizer, not a
// mocked result list. Punctuation must not merge adjacent indexed tokens.
await db.initDatabase('sqlite:literal-search');
const searchBook = await db.createNotebook('Search');
const literal = await db.createNote(searchBook.id, 'Literal search');
await db.updateCell(literal.id, literal.cells[0].id, {
  data: 'fresh-index-r3 foo:bar call(value) alpha"beta café-test 日本語-検索 ANSWER',
});
const joined = await db.createNote(searchBook.id, 'Joined tokens');
await db.updateCell(joined.id, joined.cells[0].id, { data: 'freshindexr3 foobar callvalue alphabeta' });
for (const query of ['fresh-index-r3', 'foo:bar', 'call(value)', 'alpha"beta', 'café-test', '日本語-検索', 'missing ans*']) {
  expect((await db.searchNotes(query)).map(note => note.id)).toEqual([literal.id]);
}
expect((await db.searchNotes('freshindexr3')).map(note => note.id)).toEqual([joined.id]);
for (const query of ['   ', '***', '"', '():^+-', '" OR *']) {
  expect(await db.searchNotes(query)).toEqual([]);
}
await db.deleteNote(literal.id);
expect(await db.searchNotes('fresh-index-r3')).toEqual([]);
console.log('PASS literal punctuation, quotes, Unicode and prefixes search correctly through SQLite');

// Rapid saves must collapse search work and never leave duplicate/stale rows.
await useStore.getState().loadData('sqlite:batched-search');
const batched = await useStore.getState().createNote(useStore.getState().notebooks[0].id, 'Batched');
await Promise.all(Array.from({ length: 30 }, (_, i) => db.updateCell(batched.id, batched.cells[0].id, { data: `latest${i}` })));
await db.flushSearchIndex();
expect((await db.getNote(batched.id))!.cells[0].data).toBe('latest29');
expect(connection!.query('SELECT count(*) AS c FROM notes_fts WHERE note_id=?').get(batched.id)).toEqual({ c: 1 });
expect((await db.searchNotes('latest29')).map(n => n.id)).toEqual([batched.id]);
expect(await db.searchNotes('latest0')).toEqual([]);
connection!.query('INSERT INTO notes_fts(note_id,title,content) VALUES (?,?,?)').run(batched.id, 'Stale duplicate', 'obsolete');
connection!.exec('DELETE FROM search_migrations');
await db.initDatabase('sqlite:temporary-switch');
await db.initDatabase('sqlite:batched-search');
expect(connection!.query('SELECT count(*) AS c FROM notes_fts WHERE note_id=?').get(batched.id)).toEqual({ c: 1 });
expect(await db.searchNotes('obsolete')).toEqual([]);
console.log('PASS overlapping saves coalesce indexing; migration repairs duplicate and stale search entries');

await useStore.getState().loadData('sqlite:structural-undo');
const edited = await useStore.getState().createNote(useStore.getState().notebooks[0].id, 'Cell changes');
await useStore.getState().updateCell(edited.id, edited.cells[0].id, { data: 'BeforeAfter' });
const firstCell = { ...edited.cells[0], data: 'Before' };
const secondCell = { ...firstCell, id: 'split-cell', data: 'After', sortOrder: 1 };
await useStore.getState().changeCells(edited.id, [firstCell, secondCell], secondCell.id);
expect((await db.getNote(edited.id))!.cells.map(c => c.data)).toEqual(['Before', 'After']);
expect(await useStore.getState().undoCellChange()).toBe(true);
expect((await db.getNote(edited.id))!.cells.map(c => c.data)).toEqual(['BeforeAfter']);
expect(await useStore.getState().undoCellChange(true)).toBe(true);
await useStore.getState().deleteCell(edited.id, secondCell.id);
await useStore.getState().undoCellChange();
expect((await db.getNote(edited.id))!.cells.map(c => c.id)).toEqual([firstCell.id, secondCell.id]);
await useStore.getState().moveCell(edited.id, secondCell.id, 0);
await useStore.getState().undoCellChange();
expect((await db.getNote(edited.id))!.cells.map(c => c.data)).toEqual(['Before', 'After']);
connection!.exec(`CREATE TRIGGER reject_cells BEFORE INSERT ON cells WHEN NEW.data='reject' BEGIN SELECT RAISE(ABORT,'injected failure'); END`);
await expect(db.replaceNoteCells(edited.id, [{ ...firstCell, data: 'reject' }])).rejects.toThrow('injected failure');
expect((await db.getNote(edited.id))!.cells.map(c => c.data)).toEqual(['Before', 'After']);
await expect(useStore.getState().changeCells(edited.id, [{ ...firstCell, data: 'reject' }])).rejects.toThrow('injected failure');
expect(useStore.getState().notes.find(n => n.id === edited.id)!.cells.map(c => c.data)).toEqual(['Before', 'After']);
connection!.exec('DROP TRIGGER reject_cells');
await useStore.getState().moveCell(edited.id, secondCell.id, 0);
await useStore.getState().deleteCell(edited.id, firstCell.id);
await Promise.all([useStore.getState().undoCellChange(), useStore.getState().undoCellChange()]);
expect((await db.getNote(edited.id))!.cells.map(c => c.data)).toEqual(['Before', 'After']);
await useStore.getState().moveCell(edited.id, secondCell.id, 0);
await useStore.getState().updateCell(edited.id, firstCell.id, { data: 'Edited after move' });
await useStore.getState().undoCellChange();
expect((await db.getNote(edited.id))!.cells.map(c => c.data)).toEqual(['Edited after move', 'After']);
console.log('PASS structural split/delete/move undo and redo persist atomically; failed replacement rolls back');

const other = await useStore.getState().createNote(edited.notebookId, 'Other');
const thirdNote = await useStore.getState().createNote(edited.notebookId, 'Third');
const beforeReveal = useStore.getState().navigationHistory.length;
await useStore.getState().selectNote(edited.id, true);
expect(useStore.getState().navigationHistory.length).toBe(beforeReveal + 1);
await useStore.getState().navigateHistory(-1);
expect(useStore.getState().selectedNoteId).toBe(thirdNote.id);
await useStore.getState().navigateHistory(-1);
expect(useStore.getState().selectedNoteId).toBe(other.id);
await useStore.getState().navigateHistory(-1);
expect(useStore.getState().selectedNoteId).toBe(edited.id);
await useStore.getState().navigateHistory(1);
expect(useStore.getState().selectedNoteId).toBe(other.id);
await useStore.getState().selectNote(edited.id);
expect(useStore.getState().navigationHistory).not.toContain(thirdNote.id);
await useStore.getState().loadData('sqlite:new-history');
expect(useStore.getState().navigationHistory).toEqual([]);
console.log('PASS note history supports back/forward, branches on new navigation, and resets per library');
