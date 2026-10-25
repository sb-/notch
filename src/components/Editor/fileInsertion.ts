import type { CellEdit, CellSelection } from './cells/editorBridge';

/** Capture the target before asynchronous resource storage can move the caret. */
export async function prepareFileEdit(
  files: File[],
  selected: Pick<CellSelection, 'start' | 'end'>,
  storeFile: (file: File) => Promise<string>,
): Promise<CellEdit> {
  const { start, end } = selected;
  let text = '';
  for (const file of files) text += await storeFile(file);
  const caret = start + text.length;
  return { start, end, text, selection: { start: caret, end: caret } };
}
