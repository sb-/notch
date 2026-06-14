import { test, expect, describe } from 'bun:test';
import { exportNoteToMarkdown, exportNoteToJSON } from './export';
import type { Note, Cell } from '../types';

let cellId = 0;
function cell(partial: Partial<Cell> & Pick<Cell, 'type' | 'data'>): Cell {
  return { id: `c${cellId++}`, sortOrder: 0, ...partial };
}

function note(cells: Cell[], overrides: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    notebookId: 'nb1',
    title: 'My Note',
    cells,
    tags: [],
    isFavorite: false,
    isTrashed: false,
    sortOrder: 0,
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

describe('exportNoteToMarkdown', () => {
  test('renders the title as an H1', () => {
    const md = exportNoteToMarkdown(note([]));
    expect(md.startsWith('# My Note\n')).toBe(true);
  });

  test('renders tags with a hash prefix only when present', () => {
    expect(exportNoteToMarkdown(note([]))).not.toContain('Tags:');
    const md = exportNoteToMarkdown(note([], { tags: ['rust', 'tauri'] }));
    expect(md).toContain('Tags: #rust #tauri');
  });

  test('wraps code cells in a fence carrying the language', () => {
    const md = exportNoteToMarkdown(
      note([cell({ type: 'code', data: 'let x = 1;', language: 'rust' })])
    );
    expect(md).toContain('```rust\nlet x = 1;\n```');
  });

  test('wraps latex cells in $$ delimiters', () => {
    const md = exportNoteToMarkdown(note([cell({ type: 'latex', data: 'E = mc^2' })]));
    expect(md).toContain('$$\nE = mc^2\n$$');
  });

  test('exports diagram cells as mermaid fences', () => {
    const md = exportNoteToMarkdown(
      note([cell({ type: 'diagram', data: 'graph TD; A-->B' })])
    );
    expect(md).toContain('```mermaid\ngraph TD; A-->B\n```');
  });

  test('emits text and markdown cells verbatim', () => {
    const md = exportNoteToMarkdown(
      note([
        cell({ type: 'text', data: 'plain text' }),
        cell({ type: 'markdown', data: '## heading' }),
      ])
    );
    expect(md).toContain('plain text');
    expect(md).toContain('## heading');
  });
});

describe('exportNoteToJSON', () => {
  test('produces a versioned, round-trippable payload', () => {
    const original = note(
      [cell({ type: 'code', data: 'print(1)', language: 'python' })],
      { tags: ['x'] }
    );
    const parsed = JSON.parse(exportNoteToJSON(original));

    expect(parsed.version).toBe(1);
    expect(parsed.title).toBe('My Note');
    expect(parsed.tags).toEqual(['x']);
    expect(parsed.createdAt).toBe(1000);
    expect(parsed.updatedAt).toBe(2000);
    expect(parsed.cells).toEqual([
      { type: 'code', data: 'print(1)', language: 'python', diagramType: undefined },
    ]);
  });

  test('omits internal fields like id and notebookId', () => {
    const json = exportNoteToJSON(note([]));
    expect(json).not.toContain('notebookId');
    expect(json).not.toContain('isTrashed');
  });
});
