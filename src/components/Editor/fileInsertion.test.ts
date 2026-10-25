import { expect, test } from 'bun:test';
import { prepareFileEdit } from './fileInsertion';

test('delayed image storage keeps the original selection and file order in one edit', async () => {
  let finish!: () => void;
  const saved = new Promise<void>(resolve => { finish = resolve; });
  const selected = { start: 6, end: 10 };
  const files = ['one.png', 'two.png'].map(name => new File(['image'], name, { type: 'image/png' }));
  const pending = prepareFileEdit(files, selected, async file => {
    await saved;
    return `[${file.name}]`;
  });
  // The user moves the caret while storage is pending.
  selected.start = selected.end = 28;
  finish();
  const edit = await pending;
  expect(edit).toEqual({ start: 6, end: 10, text: '[one.png][two.png]', selection: { start: 24, end: 24 } });
  const before = 'alpha beta gamma\nsecond line';
  expect(before.slice(0, edit.start) + edit.text + before.slice(edit.end)).toBe('alpha [one.png][two.png] gamma\nsecond line');
});

test('failed resource storage does not return a partial edit', async () => {
  const files = ['one.png', 'two.png'].map(name => new File(['image'], name));
  await expect(prepareFileEdit(files, { start: 0, end: 0 }, async file => {
    if (file.name === 'two.png') throw new Error('Storage failed');
    return '[one.png]';
  })).rejects.toThrow('Storage failed');
});
