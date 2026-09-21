import { expect, test } from 'bun:test';
import { diagramSource } from './diagramSource';

test('preserves existing Mermaid exactly', () => {
  const source = 'flowchart TD\n  A[Start] --> B[Finish]';
  expect(diagramSource(source)).toBe(source);
});
test('converts Quiver tutorial sequence arrows and title without changing saved source', () => {
  const source = 'Title: Here is a title\nA->B: Normal line\nB-->C: Dashed line\nC->>D: Open arrow\nD-->>A: Dashed open arrow';
  expect(diagramSource(source, 'sequence')).toBe('sequenceDiagram\ntitle Here is a title\nA->>B: Normal line\nB-->>C: Dashed line\nC-)D: Open arrow\nD--)A: Dashed open arrow');
  expect(source).toStartWith('Title:');
});
test('converts tutorial flowchart topology, multiline labels, branches and legacy links', () => {
  const source = 'st=>start: Start:>http://www.google.com[blank]\ne=>end:>http://www.google.com\nop1=>operation: My Operation\nsub1=>subroutine: My Subroutine\ncond=>condition: Yes\nor No?:>http://www.google.com\nio=>inputoutput: catch something...\n\nst->op1->cond\ncond(yes)->io->e\ncond(no)->sub1(right)->op1';
  const mermaid = diagramSource(source);
  expect(mermaid).toContain('st(["Start"])');
  expect(mermaid).toContain('cond{"Yes or No?"}');
  expect(mermaid).toContain('cond -->|yes| io');
  expect(mermaid).toContain('cond -->|no| sub1');
  expect(mermaid).toContain('sub1 --> op1');
  expect(mermaid).not.toContain('http');
});
test('unknown legacy constructs give an actionable error instead of partial output', () => {
  expect(() => diagramSource('A->B: ok\nunsupported line', 'sequence')).toThrow('unsupported syntax');
  expect(() => diagramSource('a=>start: Start\na->missing')).toThrow('unknown node');
});
