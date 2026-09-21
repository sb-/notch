import { expect, test } from 'bun:test';
import { parseLibraryBackup, type LibraryBackup } from './backup';

function fixture(): LibraryBackup {
  return { version: 2, exportedAt: 1, notebooks: [
    { id: 'parent', name: 'Parent', sortOrder: 0, createdAt: 1, updatedAt: 2 },
    { id: 'child', parentId: 'parent', name: 'Child', sortOrder: 0, createdAt: 1, updatedAt: 2 },
  ], tags: [{ id: 't', name: 'qa' }], notes: [{
    id: 'n', notebookId: 'child', title: 'Trash with image', tags: ['qa'], isTrashed: true, isFavorite: true,
    sortOrder: 0, createdAt: 1, updatedAt: 2,
    cells: [{ id: 'c', type: 'markdown', sortOrder: 0, data: '![image](notch-resource://r)' }],
  }], resources: [{ id: 'r', noteId: 'n', filename: 'test.png', mimeType: 'image/png', data: 'AQID' }] };
}
const read = (value: unknown) => parseLibraryBackup(JSON.stringify(value));

test('complete backup round trip retains trash, hierarchy, cell IDs and image bytes', () => {
  expect(read(fixture())).toEqual(fixture());
});
test('old incomplete backups are explicitly rejected', () => {
  expect(() => read({ ...fixture(), version: 1 })).toThrow('Older JSON exports');
});
test('missing resource bytes fail validation before restore', () => {
  expect(() => read({ ...fixture(), resources: [] })).toThrow('missing an embedded resource');
});
test('missing parent, cycles, and duplicate IDs cannot be restored', () => {
  const missing = fixture(); missing.notebooks[1]!.parentId = 'absent';
  expect(() => read(missing)).toThrow('hierarchy');
  const cycle = fixture(); cycle.notebooks[0]!.parentId = 'child';
  expect(() => read(cycle)).toThrow('hierarchy');
  const duplicate = fixture(); duplicate.notes.push(duplicate.notes[0]!);
  expect(() => read(duplicate)).toThrow('Duplicate note');
});
test('invalid resource encoding and cross-note resources are rejected', () => {
  const invalid = fixture(); invalid.resources[0]!.data = 'not base64';
  expect(() => read(invalid)).toThrow('encoding');
  const orphan = fixture(); orphan.resources[0]!.noteId = 'absent';
  expect(() => read(orphan)).toThrow();
});
test('invalid cell types and tag references are rejected', () => {
  const invalid = fixture() as any; invalid.notes[0].cells[0].type = 'script';
  expect(() => read(invalid)).toThrow('cell type');
  const tag = fixture(); tag.tags = [];
  expect(() => read(tag)).toThrow('missing notebook or tag');
});
