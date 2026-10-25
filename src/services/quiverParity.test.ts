import { test, expect } from 'bun:test';
import { findOffsets, noteMatches } from './noteFind';
import { notePlainText, noteCodeOnly } from './noteFormats';
import { parseCodePreferences, resolveCodeTheme } from '../store/codePreferences';
import type { Note } from '../types';
const note: Note = { id: 'note', title: 'Example', notebookId: 'book', tags: ['qa'], isFavorite: false, isTrashed: false, createdAt: 1, updatedAt: 1, sortOrder: 0, cells: [
  { id: 'markdown', type: 'markdown', data: '# Intro\nA paragraph.', sortOrder: 0 },
  { id: 'code', type: 'code', data: Array.from({ length: 1000 }, (_, n) => `const item${n} = ${n};`).join('\n'), sortOrder: 1 },
  { id: 'code2', type: 'code', data: 'console.log("end");', sortOrder: 2 },
] };
test('find reveals stable source offsets in a late code cell independently of its viewport', () => {
  const [match] = noteMatches(note, 'item999');
  expect(match?.cellId).toBe('code');
  expect(note.cells[1]!.data.slice(match!.start, match!.end)).toBe('item999');
  expect(noteMatches(note, 'const')).toHaveLength(1000);
  expect(noteMatches(note, ' ')).toEqual([]);
});
test('find handles literal punctuation and Unicode without shifting source offsets', () => {
  expect(findOffsets('x[a].* [a].*', '[a].*')).toEqual([{start:1,end:6},{start:7,end:12}]);
  expect(findOffsets('İ x abc ABC', 'abc')).toEqual([{start:4,end:7},{start:8,end:11}]);
});
test('whole-note plain text omits rich text markup and code-only excludes all other cells', () => {
  const mixed = { ...note, cells: [{id:'text',type:'text' as const,data:'<p>Hello <b>world</b> &amp; friends</p>',sortOrder:0}, note.cells[2]!] };
  expect(notePlainText(mixed)).toContain('Hello world & friends');
  expect(notePlainText(mixed)).not.toContain('<b>');
  expect(notePlainText(mixed)).toContain('#qa');
  expect(noteCodeOnly(mixed)).toBe('console.log("end");');
  expect(noteCodeOnly({...note,cells:[]})).toBe('');
});
test('code preferences validate stored values and preserve explicit false choices', () => {
  expect(parseCodePreferences({theme:'invalid',tabSize:100,keyBinding:'other',lineNumbers:false})).toMatchObject({theme:'auto',tabSize:2,keyBinding:'default',lineNumbers:false});
  expect(parseCodePreferences({theme:'vs-dark'}).theme).toBe('vs-dark');
  expect(resolveCodeTheme('auto',false)).toBe('vs');
  expect(resolveCodeTheme('auto',true)).toBe('vs-dark');
  expect(resolveCodeTheme('hc-black',false)).toBe('hc-black');
  expect(parseCodePreferences({theme:'vs',tabSize:8,keyBinding:'vim',softTabs:false})).toMatchObject({theme:'vs',tabSize:8,keyBinding:'vim',softTabs:false});
});
test('plain text preserves code indentation and paragraph boundaries while removing Markdown formatting', () => {
  const fixture = {...note,cells:[
    {id:'a',type:'markdown' as const,data:'# Heading\n\n**Strong** [link](https://example.com)\n\n![Picture](notch-resource://abc)',sortOrder:0},
    {id:'b',type:'text' as const,data:'<p>First</p><p>Second<br>Third</p>',sortOrder:1},
    {id:'c',type:'code' as const,data:'if (ready) {\n  run();\n}',sortOrder:2},
  ]};
  const result = notePlainText(fixture);
  expect(result).toContain('Heading\n\nStrong link');
  expect(result).toContain('Picture');
  expect(result).toContain('First\nSecond\nThird');
  expect(result).toContain('if (ready) {\n  run();\n}');
  expect(result).not.toContain('**');
});
import { reconcileNotes } from './noteWindowSync';
test('cross-window reconciliation updates changed notes without replacing unrelated local state', () => {
  const other = {...note,id:'other',title:'Local'};
  const added = {...note,id:'new',title:'Added'};
  const updated = {...note,title:'Updated'};
  const result = reconcileNotes([note,other], [note.id,added.id], [updated,added]);
  expect(result).toEqual([updated,other,added]);
  expect(result[1]).toBe(other);
  expect(reconcileNotes(result,[note.id],[null])).toEqual([other,added]);
});
