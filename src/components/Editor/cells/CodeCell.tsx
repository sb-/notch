import { useCallback } from 'react';
import Editor from '@monaco-editor/react';

interface CodeCellProps {
  data: string;
  language: string;
  onChange: (data: string) => void;
  onLanguageChange: (language: string) => void;
  onFocus: () => void;
  isFocused?: boolean;
  onBackspaceEmpty?: () => void;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
}

// Map our language names to Monaco language IDs
const languageMap: Record<string, string> = {
  javascript: 'javascript',
  typescript: 'typescript',
  python: 'python',
  rust: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  csharp: 'csharp',
  ruby: 'ruby',
  php: 'php',
  swift: 'swift',
  kotlin: 'kotlin',
  sql: 'sql',
  html: 'html',
  css: 'css',
  json: 'json',
  yaml: 'yaml',
  markdown: 'markdown',
  shell: 'shell',
};

export default function CodeCell({
  data,
  language,
  onChange,
  onFocus,
  onBackspaceEmpty,
  onNavigatePrev,
  onNavigateNext,
}: CodeCellProps) {
  const handleEditorMount = useCallback((editor: unknown) => {
    onFocus();
    // Type the editor for Monaco
    const monacoEditor = editor as {
      onKeyDown: (handler: (e: { browserEvent: KeyboardEvent }) => void) => void;
      getPosition: () => { lineNumber: number; column: number } | null;
      getModel: () => { getLineCount: () => number; getLineMaxColumn: (line: number) => number } | null;
    };

    monacoEditor.onKeyDown((e) => {
      const key = e.browserEvent.key;

      // Backspace on empty
      if (key === 'Backspace' && !data.trim() && onBackspaceEmpty) {
        e.browserEvent.preventDefault();
        onBackspaceEmpty();
        return;
      }

      // Arrow key navigation
      const position = monacoEditor.getPosition();
      const model = monacoEditor.getModel();
      if (!position || !model) return;

      if (key === 'ArrowUp' && onNavigatePrev) {
        // At line 1, column 1 (top-left corner)
        if (position.lineNumber === 1 && position.column === 1) {
          e.browserEvent.preventDefault();
          onNavigatePrev();
        }
      } else if (key === 'ArrowDown' && onNavigateNext) {
        // At last line, last column (bottom-right corner)
        const lastLine = model.getLineCount();
        const lastColumn = model.getLineMaxColumn(lastLine);
        if (position.lineNumber === lastLine && position.column === lastColumn) {
          e.browserEvent.preventDefault();
          onNavigateNext();
        }
      }
    });
  }, [onFocus, data, onBackspaceEmpty, onNavigatePrev, onNavigateNext]);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      onChange(value ?? '');
    },
    [onChange]
  );

  const monacoLanguage = languageMap[language] || 'plaintext';

  // Calculate height based on content (min 100px, max 500px)
  const lineCount = (data.match(/\n/g) || []).length + 1;
  const height = Math.min(Math.max(lineCount * 20 + 20, 100), 500);

  return (
    <div className="monaco-container" style={{ height: `${height}px` }}>
      <Editor
        height="100%"
        language={monacoLanguage}
        value={data}
        onChange={handleEditorChange}
        onMount={handleEditorMount}
        theme="vs-dark"
        options={{
          minimap: { enabled: false },
          lineNumbers: 'off',
          glyphMargin: false,
          folding: false,
          lineDecorationsWidth: 0,
          lineNumbersMinChars: 0,
          scrollBeyondLastLine: false,
          fontSize: 13,
          fontFamily: "'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace",
          tabSize: 2,
          automaticLayout: true,
          wordWrap: 'on',
          renderLineHighlight: 'none',
          scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
          padding: { top: 8, bottom: 8, left: 10 },
          overviewRulerBorder: false,
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
          parameterHints: { enabled: false },
          wordBasedSuggestions: 'off',
          snippetSuggestions: 'none',
          inlineSuggest: { enabled: false },
        }}
      />
    </div>
  );
}
