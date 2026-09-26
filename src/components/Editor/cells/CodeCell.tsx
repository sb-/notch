import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { loader } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import './monaco';
import { toMonacoLanguage } from '../codeLanguages';

interface CodeCellProps {
  data: string;
  language: string;
  onChange: (data: string) => void;
  onFocus: () => void;
  isFocused?: boolean;
  focusRequest?: number;
  onBackspaceEmpty?: () => void;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
}

const EDITOR_LINE_HEIGHT = 21;
const HORIZONTAL_SCROLLBAR_RESERVE = 8;
const MIN_EDITOR_HEIGHT = EDITOR_LINE_HEIGHT + HORIZONTAL_SCROLLBAR_RESERVE;

const EDITOR_OPTIONS: Monaco.editor.IStandaloneEditorConstructionOptions = {
  ariaLabel: 'Code cell',
  theme: 'vs-dark',
  minimap: { enabled: false },
  lineNumbers: 'on',
  glyphMargin: false,
  folding: false,
  lineDecorationsWidth: 12,
  lineNumbersMinChars: 3,
  scrollBeyondLastLine: false,
  fontSize: 13,
  lineHeight: EDITOR_LINE_HEIGHT,
  fontFamily: "'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace",
  tabSize: 2,
  automaticLayout: false,
  wordWrap: 'off',
  renderLineHighlight: 'none',
  scrollbar: {
    vertical: 'hidden',
    horizontal: 'auto',
    horizontalScrollbarSize: HORIZONTAL_SCROLLBAR_RESERVE,
    handleMouseWheel: false,
  },
  padding: { top: 0, bottom: 0 },
  overviewRulerBorder: false,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  parameterHints: { enabled: false },
  wordBasedSuggestions: 'off',
  snippetSuggestions: 'none',
  inlineSuggest: { enabled: false },
  occurrencesHighlight: 'off',
  selectionHighlight: false,
  wordSeparators: '',
  cursorBlinking: 'solid',
  cursorStyle: 'line',
  selectOnLineNumbers: false,
};

export default function CodeCell({
  data,
  language,
  onChange,
  onFocus,
  isFocused,
  focusRequest,
  onBackspaceEmpty,
  onNavigatePrev,
  onNavigateNext,
}: CodeCellProps) {
  const [editorHeight, setEditorHeight] = useState(MIN_EDITOR_HEIGHT);
  const [editorReady, setEditorReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const pendingInputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const applyingExternalValue = useRef(false);
  const layingOut = useRef(false);
  // Long-lived Monaco listeners must read the current note and cell callbacks.
  const latest = useRef({ data, language, onChange, isFocused, onFocus, onBackspaceEmpty, onNavigatePrev, onNavigateNext });
  latest.current = { data, language, onChange, isFocused, onFocus, onBackspaceEmpty, onNavigatePrev, onNavigateNext };

  const syncEditorHeight = useCallback((editor: Monaco.editor.IStandaloneCodeEditor) => {
    const height = Math.max(MIN_EDITOR_HEIGHT, Math.ceil(editor.getContentHeight()) + HORIZONTAL_SCROLLBAR_RESERVE);
    setEditorHeight(current => current === height ? current : height);
  }, []);

  const layoutEditor = useCallback(() => {
    const editor = editorRef.current;
    const container = containerRef.current;
    if (!editor || !container || layingOut.current) return;
    const { clientWidth: width, clientHeight: height } = container;
    if (width <= 0 || height <= 0) return;
    layingOut.current = true;
    try {
      // WKWebView may suspend animation frames while the native window is in
      // the background. Monaco's public render(true) renders synchronously, so
      // mounting and resizing never depend on the next animation frame arriving.
      editor.layout({ width, height }, true);
      editor.render(true);
      syncEditorHeight(editor);
    } finally {
      layingOut.current = false;
    }
  }, [syncEditorHeight]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let model: Monaco.editor.ITextModel | null = null;
    const subscriptions: Monaco.IDisposable[] = [];

    const createWhenVisible = () => {
      const monaco = monacoRef.current;
      if (disposed || !monaco || editorRef.current) return;
      const { clientWidth: width, clientHeight: height } = container;
      if (width <= 0 || height <= 0) return;

      const pending = pendingInputRef.current;
      const transferFocus = pending === document.activeElement;
      const selection = pending ? [pending.selectionStart, pending.selectionEnd] : null;
      model = monaco.editor.createModel(pending?.value ?? latest.current.data, toMonacoLanguage(latest.current.language));
      // Create directly in the visible, measured host. The React wrapper creates
      // Monaco inside display:none, which WKWebView can leave at its 5×5 minimum
      // until a native window resize, even when the outer container is correct.
      const editor = monaco.editor.create(container, { ...EDITOR_OPTIONS, model, dimension: { width, height } });
      editorRef.current = editor;
      const readSelection = (event: Event) => {
        const detail = (event as CustomEvent<{ offset?: number }>).detail;
        const position = editor.getPosition();
        if (position) detail.offset = model!.getOffsetAt(position);
      };
      container.addEventListener('notch-read-selection', readSelection);
      subscriptions.push({ dispose: () => container.removeEventListener('notch-read-selection', readSelection) });

      subscriptions.push(
        editor.onDidContentSizeChange(() => syncEditorHeight(editor)),
        editor.onDidFocusEditorText(() => latest.current.onFocus()),
        editor.onDidChangeModelContent(() => {
          if (!applyingExternalValue.current) latest.current.onChange(editor.getValue());
        }),
        editor.onKeyDown(event => {
          const { onBackspaceEmpty, onNavigatePrev, onNavigateNext } = latest.current;
          const key = event.browserEvent.key;
          if (key === 'Backspace' && editor.getValue() === '' && onBackspaceEmpty) {
            event.preventDefault();
            onBackspaceEmpty();
            return;
          }
          if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
          const position = editor.getPosition();
          const currentModel = editor.getModel();
          if (!position || !currentModel) return;
          if (key === 'ArrowUp' && position.lineNumber === 1 && onNavigatePrev) {
            event.preventDefault();
            onNavigatePrev();
          } else if (key === 'ArrowDown' && position.lineNumber === currentModel.getLineCount() && onNavigateNext) {
            event.preventDefault();
            onNavigateNext();
          }
        }),
      );
      syncEditorHeight(editor);
      setEditorReady(true);
      layoutEditor();
      if (transferFocus) {
        if (selection) {
          const start = model.getPositionAt(selection[0]);
          const end = model.getPositionAt(selection[1]);
          editor.setSelection({ startLineNumber: start.lineNumber, startColumn: start.column,
            endLineNumber: end.lineNumber, endColumn: end.column });
        }
        editor.focus();
      }
    };

    const observer = new ResizeObserver(() => {
      if (editorRef.current) layoutEditor();
      else createWhenVisible();
    });
    observer.observe(container);
    const initialization = loader.init();
    void initialization.then(monaco => {
      if (disposed) return;
      monacoRef.current = monaco;
      createWhenVisible();
    }).catch(error => {
      if (disposed || error?.type === 'cancelation') return;
      console.error('Unable to initialize code editor', error);
      setLoadError(true);
    });
    void document.fonts.ready.then(() => {
      if (!disposed) layoutEditor();
    });
    return () => {
      disposed = true;
      observer.disconnect();
      initialization.cancel();
      subscriptions.forEach(subscription => subscription.dispose());
      editorRef.current?.dispose();
      model?.dispose();
      editorRef.current = null;
      monacoRef.current = null;
    };
  }, [layoutEditor, syncEditorHeight]);

  useLayoutEffect(() => {
    if (editorReady) layoutEditor();
  }, [editorReady, editorHeight, layoutEditor]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    if (data !== editor.getValue()) {
      applyingExternalValue.current = true;
      try {
        editor.executeEdits('notch', [{ range: model.getFullModelRange(), text: data, forceMoveMarkers: true }]);
        editor.pushUndoStop();
      } finally {
        applyingExternalValue.current = false;
      }
      layoutEditor();
    }
  }, [data, editorReady, layoutEditor]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model) {
      monacoRef.current?.editor.setModelLanguage(model, toMonacoLanguage(language));
      editorRef.current?.render(true);
    }
  }, [language, editorReady]);

  useLayoutEffect(() => {
    if (isFocused) {
      if (editorRef.current) editorRef.current.focus();
      else pendingInputRef.current?.focus();
    }
  }, [isFocused, focusRequest]);

  return (
    <div className="code-cell-wrapper" style={{ position: 'relative' }}>
      <div ref={containerRef} className="monaco-container" style={{ height: editorHeight + 'px' }} />
      {!editorReady && (
        <textarea
          ref={pendingInputRef}
          aria-label="Code cell"
          className="cell-editor"
          style={{ position: 'absolute', inset: 0 }}
          value={data}
          onChange={event => onChange(event.target.value)}
          onFocus={onFocus}
          spellCheck={false}
          placeholder={loadError ? 'Code editor unavailable; plain-text editing is active.' : ''}
        />
      )}
    </div>
  );
}
