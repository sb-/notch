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
          padding: { top: 12, bottom: 12, left: 8 },
          overviewRulerBorder: false,
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
          parameterHints: { enabled: false },
          wordBasedSuggestions: 'off',
          snippetSuggestions: 'none',
          inlineSuggest: { enabled: false },
          // Disable word selection on click
          occurrencesHighlight: 'off',
          selectionHighlight: false,
          // Disable double-click word select expansion
          wordSeparators: '',
          // Simpler cursor behavior
          cursorBlinking: 'solid',
          cursorStyle: 'line',
          selectOnLineNumbers: false,
        }}
      />
    </div>
  );
}
