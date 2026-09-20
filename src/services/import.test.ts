import { test, expect, describe, mock, beforeEach } from 'bun:test';
import * as realFs from '@tauri-apps/plugin-fs';
import * as realDb from './database';

// bun:test runs every test file in one process and mock.module is process-wide.
// We therefore spread the real modules (so other files keep e.g. fs.mkdir and
// db.rewriteQuiverLinksInText) and re-install the db mock in beforeEach so this
// file's stub wins while its tests run, regardless of load order.

// ---- Fake filesystem ---------------------------------------------------------
// readDir/readTextFile are backed by these maps, populated per-test. This lets us
// simulate a Quiver .qvlibrary directory tree without touching disk or Tauri.
let dirs: Record<string, { name: string; isDirectory: boolean; isFile: boolean }[]> = {};
let files: Record<string, string> = {};

mock.module('@tauri-apps/plugin-fs', () => ({
  ...realFs,
  readDir: async (path: string) => {
    if (!(path in dirs)) throw new Error(`ENOENT readDir ${path}`);
    return dirs[path];
  },
  readTextFile: async (path: string) => {
    if (!(path in files)) throw new Error(`ENOENT readTextFile ${path}`);
    return files[path];
  },
}));

// ---- Fake database -----------------------------------------------------------
// Records every createNotebook call so we can assert the parent wiring. Returns a
// notebook whose id is derived from its name, so child calls reference a stable id.
let createNotebookCalls: { name: string; parentId?: string }[] = [];

function installDbMock() {
  mock.module('./database', () => ({
    ...realDb,
    getAllNotebooks: async () => [],
    createNotebook: async (name: string, parentId?: string) => {
      createNotebookCalls.push({ name, parentId });
      return { id: `${name}-id`, name, parentId, sortOrder: 0, createdAt: 0, updatedAt: 0 };
    },
    rewriteQuiverNoteLinks: async () => 0,
  }));
}
installDbMock();

const { importQuiverLibrary, scanForDuplicates, summarizeImport } = await import('./import');

// ---- Fixture helpers ---------------------------------------------------------
const LIB = '/lib';

function dirEntry(name: string, kind: 'dir' | 'file') {
  return { name, isDirectory: kind === 'dir', isFile: kind === 'file' };
}

// Register a .qvnotebook with the given name/uuid. `children` mirrors the per-
// notebook meta.json `children` array (one way Quiver records nesting). The
// notebook contains no .qvnote dirs, so no notes are imported -- keeps the test
// focused purely on notebook hierarchy.
function notebook(name: string, uuid: string, children?: string[]) {
  const path = `${LIB}/${name}.qvnotebook`;
  dirs[path] = [dirEntry('meta.json', 'file')];
  files[`${path}/meta.json`] = JSON.stringify({ name, uuid, children });
  return dirEntry(`${name}.qvnotebook`, 'dir');
}

describe('importQuiverLibrary notebook nesting', () => {
  beforeEach(() => {
    dirs = {};
    files = {};
    createNotebookCalls = [];
    installDbMock();
  });

  test('preserves nesting declared in the library Meta.json hierarchy', async () => {
    // Three-level chain: Parent > Child > Grandchild, declared in Meta.json.
    dirs[LIB] = [
      dirEntry('Meta.json', 'file'),
      notebook('Parent', 'P'),
      notebook('Child', 'C'),
      notebook('Grandchild', 'G'),
    ];
    files[`${LIB}/Meta.json`] = JSON.stringify({
      children: [{ uuid: 'P', children: [{ uuid: 'C', children: [{ uuid: 'G' }] }] }],
    });

    const result = await importQuiverLibrary(LIB);

    expect(result.notebooks).toBe(3);
    // Parents are created before children, each wired to its parent's new id.
    expect(createNotebookCalls).toEqual([
      { name: 'Parent', parentId: undefined },
      { name: 'Child', parentId: 'Parent-id' },
      { name: 'Grandchild', parentId: 'Child-id' },
    ]);
  });

  test('preserves nesting declared via per-notebook meta.json children', async () => {
    // No library Meta.json -- nesting comes from Parent's own `children` list.
    dirs[LIB] = [notebook('Parent', 'P', ['C']), notebook('Child', 'C')];

    const result = await importQuiverLibrary(LIB);

    expect(result.notebooks).toBe(2);
    expect(createNotebookCalls).toEqual([
      { name: 'Parent', parentId: undefined },
      { name: 'Child', parentId: 'Parent-id' },
    ]);
  });

  test('imports flat notebooks with no parent', async () => {
    dirs[LIB] = [notebook('A', 'a'), notebook('B', 'b')];

    await importQuiverLibrary(LIB);

    expect(createNotebookCalls).toEqual([
      { name: 'A', parentId: undefined },
      { name: 'B', parentId: undefined },
    ]);
  });

  test('surfaces unreadable notebook metadata instead of claiming zero-result success', async () => {
    dirs[LIB] = [dirEntry('Private.qvnotebook', 'dir')];
    const result = await importQuiverLibrary(LIB);
    expect(result.notebooks).toBe(0);
    expect(result.notebooksFailed).toBe(1);
    expect(result.errors[0].notePath).toBe('/lib/Private.qvnotebook/meta.json');
    expect(summarizeImport(result)).toMatchObject({ title: 'Import Failed', kind: 'error' });
    expect(summarizeImport(result).text).toContain('ENOENT');
    expect(summarizeImport(result).text).not.toContain('Successfully');
  });

  test('preserves usable notebooks and reports a partial metadata failure', async () => {
    dirs[LIB] = [notebook('Readable', 'ok'), dirEntry('Broken.qvnotebook', 'dir')];
    const result = await importQuiverLibrary(LIB);
    expect(result.notebooks).toBe(1);
    expect(result.notebooksFailed).toBe(1);
    expect(summarizeImport(result)).toMatchObject({ title: 'Import Completed with Errors', kind: 'warning' });
  });

  test('does not create or count a notebook whose contents cannot be listed', async () => {
    dirs[LIB] = [notebook('Denied', 'denied')];
    delete dirs['/lib/Denied.qvnotebook'];
    const result = await importQuiverLibrary(LIB);
    expect(result.notebooks).toBe(0);
    expect(result.notebooksFailed).toBe(1);
    expect(createNotebookCalls).toEqual([]);
    expect(summarizeImport(result).kind).toBe('error');
  });

  test('reports invalid selections and unreadable root paths', async () => {
    dirs[LIB] = [];
    expect(summarizeImport(await importQuiverLibrary(LIB)).text).toContain('No .qvnotebook folders');
    await expect(scanForDuplicates('/denied')).rejects.toThrow('ENOENT');
    expect(summarizeImport(await importQuiverLibrary('/denied')).kind).toBe('error');
  });

  test('rejects malformed and cyclic notebook metadata without partial hierarchy creation', async () => {
    dirs[LIB] = [notebook('Malformed', 'bad')];
    files['/lib/Malformed.qvnotebook/meta.json'] = '{}';
    expect((await importQuiverLibrary(LIB)).notebooksFailed).toBe(1);
    dirs[LIB] = [notebook('A', 'a', ['b']), notebook('B', 'b', ['a'])];
    const result = await importQuiverLibrary(LIB);
    expect(result.notebooks).toBe(0);
    expect(result.errors[0].error).toContain('cycle');
    expect(createNotebookCalls).toEqual([]);
  });
});
