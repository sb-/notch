import { expect, test } from 'bun:test';
import { asyncCache } from './asyncCache';

test('editor and preview share pending renders, including repeat note visits', async () => {
  let calls = 0;
  const render = asyncCache(async (source: string) => { calls++; return `<svg>${source}</svg>`; });
  const [editor, preview] = await Promise.all([render('diagram'), render('diagram')]);
  expect(editor).toBe(preview);
  for (let i = 0; i < 100; i++) await render('diagram');
  expect(calls).toBe(1);
});

test('failed renders retry, eviction is bounded and recent entries survive', async () => {
  let calls = 0;
  const render = asyncCache(async (source: string) => {
    calls++;
    if (source === 'bad') throw Error('syntax');
    return source;
  }, 2);
  await expect(render('bad')).rejects.toThrow('syntax');
  await expect(render('bad')).rejects.toThrow('syntax');
  await render('a'); await render('b'); await render('a'); await render('c');
  expect(calls).toBe(5);
  await render('a');
  expect(calls).toBe(5);
  await render('b');
  expect(calls).toBe(6);
});
