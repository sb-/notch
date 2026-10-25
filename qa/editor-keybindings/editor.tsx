import { Suspense, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import MarkdownCell from '../../src/components/Editor/cells/MarkdownCell';
import CodeCell from '../../src/components/Editor/cells/CodeCell';
import { useCodePreferences } from '../../src/store/codePreferences';
import { revealMatch } from '../../src/services/noteFind';
import { applyCellEdit, readCellSelection } from '../../src/components/Editor/cells/editorBridge';
import { formatMarkdownSelection } from '../../src/components/Editor/formatting';
import { minimalReplacement } from '../../src/components/Editor/textEdits';
import MonacoCellEditor, { type FileInsertion } from '../../src/components/Editor/cells/MonacoCellEditor';
import '../../src/styles/index.css';

function Harness() {
  const [data, setData] = useState('alpha beta gamma\nsecond line');
  const [kind, setKind] = useState('markdown');
  const [selection, setSelection] = useState('{}');
  const pendingSave = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  const delayedImages = useMemo<FileInsertion>(() => ({
    accepts: file => file.type.startsWith('image/'),
    text: async file => {
      await pendingSave.current?.promise;
      return `[${file.name}]`;
    },
  }), []);
  const preferences = useCodePreferences(state => state.preferences);
  const cell = () => document.querySelector<HTMLElement>('[data-cell-id="test"]')!;
  const inspect = () => {
    setSelection(JSON.stringify(readCellSelection(cell())));
  };
  const format = () => {
    const selected = readCellSelection(cell());
    if (!selected) return;
    const result = formatMarkdownSelection(selected.value, selected.start, selected.end, 'bold');
    applyCellEdit(cell(), { ...minimalReplacement(selected.value, result.data), selection: result, focus: true });
  };
  const insertImage = () => {
    const selected = readCellSelection(cell());
    if (!selected) return;
    const text = '\n![test](notch-resource://test)\n';
    const caret = selected.start + text.length;
    applyCellEdit(cell(), { ...selected, text, selection: { start: caret, end: caret }, focus: true });
  };
  const pasteDelayedImages = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    pendingSave.current = { promise, resolve };
    const clipboardData = new DataTransfer();
    for (const name of ['one.png', 'two.png']) clipboardData.items.add(new File(['test'], name, { type: 'image/png' }));
    cell().querySelector('.monaco-container')?.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  };
  return <main style={{ padding: 24, width: 700 }} onKeyUp={inspect}>
    <h1>Editor keybinding regression checks</h1>
    <label>Binding <select aria-label="Binding" value={preferences.keyBinding} onChange={e => useCodePreferences.getState().update({ keyBinding: e.target.value as typeof preferences.keyBinding })}>
      <option value="default">Standard</option><option value="emacs">Emacs</option><option value="vim">Vim</option>
    </select></label>
    <label>Cell <select aria-label="Cell" value={kind} onChange={e => setKind(e.target.value)}><option>markdown</option><option>code</option><option>delayed-images</option></select></label>
    <button onClick={() => setData('alpha beta gamma\nsecond line')}>Reset text</button>
    <button onMouseDown={e => e.preventDefault()} onClick={format}>Bold selection</button>
    <button onClick={inspect}>Inspect selection</button>
    <button onClick={() => revealMatch({ cellId: 'test', start: 6, end: 10 })}>Find beta</button>
    <button onMouseDown={e => e.preventDefault()} onClick={insertImage}>Insert image markup</button>
    {kind === 'delayed-images' && <>
      <button onMouseDown={e => e.preventDefault()} onClick={pasteDelayedImages}>Start image paste</button>
      <button onMouseDown={e => e.preventDefault()} onClick={() => pendingSave.current?.resolve()}>Finish image save</button>
    </>}
    <div className={`cell focused cell-${kind}`} data-cell-id="test" style={{ marginTop: 24 }}>
      <Suspense fallback={<p>Loading…</p>}>
        {kind === 'markdown'
          ? <MarkdownCell noteId="test" data={data} onChange={setData} onFocus={() => {}} />
          : kind === 'code' ? <CodeCell language="markdown" data={data} onChange={setData} onFocus={() => {}} />
            : <MonacoCellEditor language="markdown" ariaLabel="Image test cell" wrapperClassName="markdown-cell-wrapper" options={{ wordWrap: 'on', lineHeight: 20, scrollBeyondLastLine: false, minimap: { enabled: false } }} scrollbarReserve={8} data={data} onChange={setData} onFocus={() => {}} fileInsertion={delayedImages} />}
      </Suspense>
    </div>
    <h2>Saved text</h2><pre aria-label="Saved text">{data}</pre>
    <h2>Selection offsets</h2><output>{selection}</output>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
