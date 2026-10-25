import { useMemo, useRef } from 'react';
import type * as Monaco from 'monaco-editor';
import { createResourceFromFile, RESOURCE_PROTOCOL } from '../../../services/resources';
import { isImageFile, markdownImageSnippet } from '../textEdits';
import MonacoCellEditor, { type FileInsertion } from './MonacoCellEditor';

interface MarkdownCellProps {
  noteId: string;
  data: string;
  onChange: (data: string) => void;
  onFocus: () => void;
  isFocused?: boolean;
  focusRequest?: number;
  onBackspaceEmpty?: () => void;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
}

const LINE_HEIGHT = 20;

// Markdown is prose: wrap to the cell width (no horizontal scrolling), no
// gutter, and none of the code-editor conveniences that fight typing and
// copying sentences. Height follows the content, like code cells; the page
// scrolls, not the editor. Indentation is set on the model (MARKDOWN_MODEL),
// never here: construction options are shared Monaco configuration.
const MARKDOWN_OPTIONS: Monaco.editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  lineNumbers: 'off',
  glyphMargin: false,
  folding: false,
  lineDecorationsWidth: 0,
  lineNumbersMinChars: 0,
  scrollBeyondLastLine: false,
  fontSize: 13,
  lineHeight: LINE_HEIGHT,
  fontFamily: "'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace",
  automaticLayout: false,
  wordWrap: 'on',
  wrappingIndent: 'same',
  renderLineHighlight: 'none',
  renderWhitespace: 'none',
  guides: { indentation: false },
  matchBrackets: 'never',
  autoClosingBrackets: 'never',
  autoClosingQuotes: 'never',
  autoSurround: 'never',
  unicodeHighlight: { ambiguousCharacters: false },
  stickyScroll: { enabled: false },
  scrollbar: {
    vertical: 'hidden',
    horizontal: 'hidden',
    // A hidden scrollbar still narrows the wrapping column by its size.
    verticalScrollbarSize: 0,
    horizontalScrollbarSize: 0,
    handleMouseWheel: false,
    alwaysConsumeMouseWheel: false,
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
  cursorBlinking: 'solid',
  cursorStyle: 'line',
  // Clipboard and pointer behave like the plain text editor this replaced:
  // plain-text copies (no theme colours into Text cells or other apps),
  // nothing copied or cut without a selection, the native context menu, no
  // link underlines/hovers, and no "paste as"/"drop as" pickers.
  copyWithSyntaxHighlighting: false,
  emptySelectionClipboard: false,
  contextmenu: false,
  links: false,
  hover: { enabled: false },
  pasteAs: { enabled: false },
  dropIntoEditor: { enabled: true, showDropSelector: 'never' },
};

const MARKDOWN_MODEL: Monaco.editor.ITextModelUpdateOptions = { tabSize: 2, insertSpaces: true };

export default function MarkdownCell({ noteId, ...props }: MarkdownCellProps) {
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;

  // Pasted and dropped images become note resources, referenced by markdown
  // inserted at the caret (or the drop point).
  const imageInsertion = useMemo<FileInsertion>(() => ({
    accepts: isImageFile,
    text: async file => {
      const id = await createResourceFromFile(noteIdRef.current, file);
      return markdownImageSnippet(file.name, `${RESOURCE_PROTOCOL}${id}`);
    },
  }), []);

  return (
    <MonacoCellEditor
      {...props}
      language="markdown"
      ariaLabel="Markdown cell"
      wrapperClassName="markdown-cell-wrapper"
      options={MARKDOWN_OPTIONS}
      modelOptions={MARKDOWN_MODEL}
      blurOnEscape
      appShortcuts
      indentOnTab
      fileInsertion={imageInsertion}
    />
  );
}
