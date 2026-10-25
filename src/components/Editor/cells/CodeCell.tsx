import type * as Monaco from 'monaco-editor';
import type { CodePreferences } from '../../../store/codePreferences';
import { toMonacoLanguage } from '../codeLanguages';
import MonacoCellEditor, { type MonacoEditor } from './MonacoCellEditor';

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

const EDITOR_OPTIONS: Monaco.editor.IStandaloneEditorConstructionOptions = {
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

function applyCodePreferences(editor: MonacoEditor, preferences: CodePreferences) {
  editor.updateOptions({
    lineNumbers: preferences.lineNumbers ? 'on' : 'off',
    renderWhitespace: preferences.invisibles ? 'all' : 'none',
    guides: { indentation: preferences.indentGuides },
  });
  editor.getModel()?.updateOptions({ tabSize: preferences.tabSize, insertSpaces: preferences.softTabs });
}

export default function CodeCell({ language, ...props }: CodeCellProps) {
  return (
    <MonacoCellEditor
      {...props}
      language={toMonacoLanguage(language)}
      ariaLabel="Code cell"
      wrapperClassName="code-cell-wrapper"
      options={EDITOR_OPTIONS}
      scrollbarReserve={HORIZONTAL_SCROLLBAR_RESERVE}
      applyPreferences={applyCodePreferences}
    />
  );
}
