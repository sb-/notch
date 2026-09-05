import { useCallback, useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { toMonacoLanguage } from '../codeLanguages';

interface CodeCellProps {
  data: string;
  language: string;
  onChange: (data: string) => void;
  onFocus: () => void;
  isFocused?: boolean;
  onBackspaceEmpty?: () => void;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
}

const EDITOR_FONT_SIZE = 13;
const EDITOR_LINE_HEIGHT = 21;
const HORIZONTAL_SCROLLBAR_RESERVE = 8;
const MIN_EDITOR_HEIGHT = EDITOR_LINE_HEIGHT;

export default function CodeCell({
  data,
  language,
  onChange,
  onFocus,
  onBackspaceEmpty,
  onNavigatePrev,
  onNavigateNext,
}: CodeCellProps) {
  const [editorHeight, setEditorHeight] = useState(MIN_EDITOR_HEIGHT);
  const editorRef = useRef<{
    getContentHeight: () => number;
    layout: (dimension?: { width: number; height: number }) => void;
  } | null>(null);
  const dataRef = useRef(data);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // No manual layout() on height change: `automaticLayout` already observes the
  // container (and is needed for width changes when the editor column resizes),
  // so it re-lays-out when the height style updates. Calling it here too caused a
  // redundant second layout pass on every line add/remove.

  const syncEditorHeight = useCallback((editor = editorRef.current) => {
    if (!editor) return;

    const height = Math.max(
      MIN_EDITOR_HEIGHT,
      Math.ceil(editor.getContentHeight()) + HORIZONTAL_SCROLLBAR_RESERVE
    );
    setEditorHeight(current => current === height ? current : height);
  }, []);

  const handleEditorMount = useCallback((editor: unknown) => {
    onFocus();
    // Type the editor for Monaco
    const monacoEditor = editor as {
      onKeyDown: (handler: (e: { browserEvent: KeyboardEvent }) => void) => void;
      onDidContentSizeChange: (handler: () => void) => { dispose: () => void };
      getContentHeight: () => number;
      getPosition: () => { lineNumber: number; column: number } | null;
      layout: (dimension?: { width: number; height: number }) => void;
      getModel: () => { getLineCount: () => number; getLineMaxColumn: (line: number) => number } | null;
    };
    editorRef.current = monacoEditor;
    syncEditorHeight(monacoEditor);
    monacoEditor.onDidContentSizeChange(() => syncEditorHeight(monacoEditor));

    monacoEditor.onKeyDown((e) => {
      const key = e.browserEvent.key;

      // Backspace on empty
      if (key === 'Backspace' && dataRef.current === '' && onBackspaceEmpty) {
        e.browserEvent.preventDefault();
        onBackspaceEmpty();
        return;
      }

      // Arrow key navigation
      const position = monacoEditor.getPosition();
      const model = monacoEditor.getModel();
      if (!position || !model) return;

      if (key === 'ArrowUp' && onNavigatePrev) {
        // On line 1 - navigate to previous cell
        if (position.lineNumber === 1) {
          e.browserEvent.preventDefault();
          onNavigatePrev();
        }
      } else if (key === 'ArrowDown' && onNavigateNext) {
        // On last line - navigate to next cell
        const lastLine = model.getLineCount();
        if (position.lineNumber === lastLine) {
          e.browserEvent.preventDefault();
          onNavigateNext();
        }
      }
    });
  }, [onFocus, onBackspaceEmpty, onNavigatePrev, onNavigateNext, syncEditorHeight]);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      onChange(value ?? '');
    },
    [onChange]
  );

  const monacoLanguage = toMonacoLanguage(language);

  return (
    <div className="code-cell-wrapper">
      <div className="monaco-container" style={{ height: `${editorHeight}px` }}>
        <Editor
          height="100%"
          language={monacoLanguage}
          value={data}
          onChange={handleEditorChange}
          onMount={handleEditorMount}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            lineNumbers: 'on',
            glyphMargin: false,
            folding: false,
            lineDecorationsWidth: 12,
            lineNumbersMinChars: 3,
            scrollBeyondLastLine: false,
            fontSize: EDITOR_FONT_SIZE,
            lineHeight: EDITOR_LINE_HEIGHT,
            fontFamily: "'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace",
            tabSize: 2,
            automaticLayout: true,
            wordWrap: 'off',
            renderLineHighlight: 'none',
            scrollbar: {
              vertical: 'hidden',
              horizontal: 'auto',
              horizontalScrollbarSize: 8,
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
          }}
        />
      </div>
    </div>
  );
}
