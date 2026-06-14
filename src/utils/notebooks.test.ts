import { test, expect, describe } from 'bun:test';
import { isDescendantOf, getNotebookSubtreeIds } from './notebooks';
import type { Notebook } from '../types';

// Helper to build a minimal Notebook with just the fields these functions read.
function nb(id: string, parentId?: string): Notebook {
  return {
    id,
    name: id,
    parentId,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

// A small tree:
//   root
//   ├── a
//   │   └── a1
//   └── b
//   orphan (no parent, unrelated)
const tree: Notebook[] = [
  nb('root'),
  nb('a', 'root'),
  nb('a1', 'a'),
  nb('b', 'root'),
  nb('orphan'),
];

describe('isDescendantOf', () => {
  test('direct child is a descendant', () => {
    expect(isDescendantOf(tree, 'a', 'root')).toBe(true);
  });

  test('deep descendant is found through the chain', () => {
    expect(isDescendantOf(tree, 'a1', 'root')).toBe(true);
  });

  test('unrelated notebook is not a descendant', () => {
    expect(isDescendantOf(tree, 'orphan', 'root')).toBe(false);
  });

  test('sibling is not a descendant', () => {
    expect(isDescendantOf(tree, 'b', 'a')).toBe(false);
  });

  test('a notebook is not its own descendant', () => {
    expect(isDescendantOf(tree, 'root', 'root')).toBe(false);
  });

  test('unknown id returns false', () => {
    expect(isDescendantOf(tree, 'missing', 'root')).toBe(false);
  });
});

describe('getNotebookSubtreeIds', () => {
  test('includes the notebook itself', () => {
    expect(getNotebookSubtreeIds(tree, 'a1')).toEqual(new Set(['a1']));
  });

  test('collects all transitive descendants', () => {
    expect(getNotebookSubtreeIds(tree, 'root')).toEqual(
      new Set(['root', 'a', 'a1', 'b'])
    );
  });

  test('collects a partial subtree from a mid-level node', () => {
    expect(getNotebookSubtreeIds(tree, 'a')).toEqual(new Set(['a', 'a1']));
  });

  test('an unknown id yields just that id', () => {
    expect(getNotebookSubtreeIds(tree, 'missing')).toEqual(new Set(['missing']));
  });
});
