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

// Languages offered in the picker (value = Monaco language id, with a friendly label).
const LANGUAGE_OPTIONS: { id: string; label: string }[] = [
  { id: 'plaintext', label: 'Plain Text' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'python', label: 'Python' },
  { id: 'rust', label: 'Rust' },
  { id: 'go', label: 'Go' },
  { id: 'java', label: 'Java' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'objective-c', label: 'Objective-C' },
  { id: 'swift', label: 'Swift' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'scala', label: 'Scala' },
  { id: 'dart', label: 'Dart' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'php', label: 'PHP' },
  { id: 'perl', label: 'Perl' },
  { id: 'lua', label: 'Lua' },
  { id: 'r', label: 'R' },
  { id: 'elixir', label: 'Elixir' },
  { id: 'clojure', label: 'Clojure' },
  { id: 'sql', label: 'SQL' },
  { id: 'graphql', label: 'GraphQL' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'scss', label: 'SCSS' },
  { id: 'less', label: 'Less' },
  { id: 'json', label: 'JSON' },
  { id: 'yaml', label: 'YAML' },
  { id: 'xml', label: 'XML' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'shell', label: 'Shell' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'ini', label: 'INI / TOML' },
];

// Resolve stored language names (including legacy/Quiver/ACE aliases) to Monaco ids.
const languageAliases: Record<string, string> = {
  c_cpp: 'cpp',
  'c++': 'cpp',
  golang: 'go',
  objectivec: 'objective-c',
  objc: 'objective-c',
  text: 'plaintext',
  plain: 'plaintext',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  jsx: 'javascript',
  tsx: 'typescript',
  yml: 'yaml',
  toml: 'ini',
  'c#': 'csharp',
  htmlmixed: 'html',
};

function toMonacoLanguage(language: string): string {
  const lower = (language || '').toLowerCase();
  return languageAliases[lower] || lower || 'plaintext';
}

export default function CodeCell({
  data,
  language,
  onChange,
  onLanguageChange,
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

  const monacoLanguage = toMonacoLanguage(language);

  // Show the stored language in the dropdown even if it isn't a preset option.
  const knownOption = LANGUAGE_OPTIONS.some(option => option.id === monacoLanguage);

  // Calculate height based on content (min 100px, max 500px)
  const lineCount = (data.match(/\n/g) || []).length + 1;
  const height = Math.min(Math.max(lineCount * 20 + 20, 100), 500);

  return (
    <div className="code-cell-wrapper">
      <div className="code-cell-toolbar">
        <select
          className="code-lang-select"
          value={monacoLanguage}
          onChange={(e) => onLanguageChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          title="Language"
        >
          {!knownOption && <option value={monacoLanguage}>{language || 'Plain Text'}</option>}
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
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
            padding: { top: 12, bottom: 12 },
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
