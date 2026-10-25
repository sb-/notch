import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { loader } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { APP_SHORTCUTS_CONTEXT, installKeybindingRules, loadKeyBinding } from './monaco';
import { useCodePreferences, useResolvedCodeTheme, type CodePreferences } from '../../../store/codePreferences';
import { APPLY_EDIT_EVENT, READ_SELECTION_EVENT, applyCellEdit, readCellSelection, type CellEdit, type ReadSelectionDetail } from './editorBridge';
import { cellKeyIntent, clampOffset, estimateEditorHeight, minimalReplacement, type CellKeyIntent } from '../textEdits';
import { prepareFileEdit } from '../fileInsertion';

export type MonacoNamespace = typeof Monaco;
export type MonacoEditor = Monaco.editor.IStandaloneCodeEditor;

/** Files the cell accepts by paste or drop, inserted at the caret as text. */
export interface FileInsertion {
  accepts: (file: File) => boolean;
  /** Text inserted for one accepted file (e.g. after storing it as a resource). */
  text: (file: File) => Promise<string>;
}

export interface MonacoCellEditorProps {
  data: string;
  /** Monaco language id. */
  language: string;
  onChange: (data: string) => void;
  onFocus: () => void;
  isFocused?: boolean;
  focusRequest?: number;
  onBackspaceEmpty?: () => void;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
  ariaLabel: string;
  wrapperClassName: string;
  /** Construction options; read once, when the editor is created. */
  options: Monaco.editor.IStandaloneEditorConstructionOptions;
  /**
   * Indentation for this editor's model only. Indentation in construction
   * options is written to Monaco's shared configuration and resets every other
   * model's options, so per-cell-type indentation belongs here.
   */
  modelOptions?: Monaco.editor.ITextModelUpdateOptions;
  /** Height kept below the content for a horizontal scrollbar. */
  scrollbarReserve?: number;
  /** Maps code preferences onto this editor. The theme is applied here for every cell. */
  applyPreferences?: (editor: MonacoEditor, preferences: CodePreferences) => void;
  /** Escape blurs the editor (never in Vim mode, where Escape belongs to Vim). */
  blurOnEscape?: boolean;
  /** Cmd+F, Cmd+[ and Cmd+] reach the app (note Find, Back/Forward) instead of Monaco. */
  appShortcuts?: boolean;
  /** Plain Tab indents even with the Emacs binding (which maps Tab to Format Document). */
  indentOnTab?: boolean;
  /** Pasted/dropped files to insert, in Monaco and in the textarea fallback. */
  fileInsertion?: FileInsertion;
}

function toRange(model: Monaco.editor.ITextModel, start: number, end: number): Monaco.IRange {
  const length = model.getValueLength();
  const from = model.getPositionAt(clampOffset(start, length));
  const to = model.getPositionAt(Math.max(clampOffset(start, length), clampOffset(end, length)));
  return { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column };
}

// Replace an offset range as one undoable edit, then optionally select/focus.
// The change reaches the cell through onDidChangeModelContent like typing does.
export function applyEditorEdit(editor: MonacoEditor, edit: CellEdit, source = 'notch'): boolean {
  const model = editor.getModel();
  if (!model) return false;
  editor.pushUndoStop();
  editor.executeEdits(source, [{ range: toRange(model, edit.start, edit.end), text: edit.text, forceMoveMarkers: true }]);
  editor.pushUndoStop();
  if (edit.selection) {
    const { selection } = edit;
    const range = toRange(model, selection.start, selection.end);
    editor.setSelection(range);
    editor.revealRangeInCenterIfOutsideViewport(range);
  }
  if (edit.focus) editor.focus();
  return true;
}

// Monaco cells and their plain-textarea fallback share one lifecycle: deferred
// creation once the host is measurable, synchronous layout (WKWebView), content
// height sizing, external value sync, find/selection/edit events, cell
// navigation keys, and the Vim/Emacs key binding from code preferences.
export default function MonacoCellEditor({
  data,
  language,
  onChange,
  onFocus,
  isFocused,
  focusRequest,
  onBackspaceEmpty,
  onNavigatePrev,
  onNavigateNext,
  ariaLabel,
  wrapperClassName,
  options,
  scrollbarReserve = 0,
  applyPreferences,
  blurOnEscape = false,
  appShortcuts = false,
  indentOnTab = false,
  modelOptions,
  fileInsertion,
}: MonacoCellEditorProps) {
  const preferences = useCodePreferences(state => state.preferences);
  const theme = useResolvedCodeTheme();
  const lineHeight = options.lineHeight || 21;
  const minHeight = lineHeight + scrollbarReserve;
  const wraps = options.wordWrap !== undefined && options.wordWrap !== 'off';
  const statusRef = useRef<HTMLDivElement>(null);
  const [editorHeight, setEditorHeight] = useState(minHeight);
  const [pendingHeight, setPendingHeight] = useState<number | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pendingInputRef = useRef<HTMLTextAreaElement>(null);
  const pendingMirrorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoEditor | null>(null);
  const monacoRef = useRef<MonacoNamespace | null>(null);
  // Creates the editor if Monaco is loaded and the host is measurable; set
  // while the creation effect is mounted.
  const requestCreateRef = useRef<(() => void) | null>(null);
  // The cell must become an editor now (focus), even if it is off screen.
  const wantedRef = useRef(false);
  const applyingExternalValue = useRef(false);
  const layingOut = useRef(false);
  // Long-lived Monaco listeners must read the current note and cell callbacks.
  const current = {
    data, language, onChange, onFocus, onBackspaceEmpty, onNavigatePrev, onNavigateNext,
    options, modelOptions, ariaLabel, scrollbarReserve, minHeight, lineHeight, blurOnEscape, appShortcuts, indentOnTab,
    preferences, theme, applyPreferences, fileInsertion,
  };
  const latest = useRef(current);
  latest.current = current;

  const syncEditorHeight = useCallback((editor: MonacoEditor) => {
    const { minHeight, scrollbarReserve } = latest.current;
    const height = Math.max(minHeight, Math.ceil(editor.getContentHeight()) + scrollbarReserve);
    setEditorHeight(value => value === height ? value : height);
  }, []);

  // Before Monaco exists, a word-wrapped cell is sized from a hidden mirror of
  // the fallback textarea (same width and text metrics), so wrapped prose is
  // neither clipped nor resized when Monaco takes over.
  const measurePending = useCallback(() => {
    const mirror = pendingMirrorRef.current;
    const input = pendingInputRef.current;
    if (!mirror || !input || input.clientWidth <= 0) return;
    mirror.style.width = `${input.clientWidth}px`;
    const { minHeight, lineHeight } = latest.current;
    const rows = Math.max(1, Math.round(mirror.getBoundingClientRect().height / lineHeight));
    const height = Math.max(minHeight, rows * lineHeight);
    setPendingHeight(value => value === height ? value : height);
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

  const runIntent = useCallback((intent: CellKeyIntent): boolean => {
    const { onBackspaceEmpty, onNavigatePrev, onNavigateNext } = latest.current;
    const handler = intent === 'backspace-empty' ? onBackspaceEmpty
      : intent === 'navigate-prev' ? onNavigatePrev
        : intent === 'navigate-next' ? onNavigateNext : undefined;
    handler?.();
    return Boolean(handler);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let model: Monaco.editor.ITextModel | null = null;
    const subscriptions: Monaco.IDisposable[] = [];
    const listen = (type: string, listener: (event: Event) => void) => {
      container.addEventListener(type, listener);
      subscriptions.push({ dispose: () => container.removeEventListener(type, listener) });
    };

    // Monaco is created only for cells near the viewport (or focused): an
    // editor per off-screen cell would make opening a long note one long task.
    // Until then the textarea fallback is the cell's (fully working) editor.
    let near = typeof IntersectionObserver === 'undefined';
    const createWhenVisible = () => {
      const monaco = monacoRef.current;
      if (disposed || !monaco || editorRef.current) return;
      if (!near && !wantedRef.current) return;
      const { clientWidth: width, clientHeight: height } = container;
      if (width <= 0 || height <= 0) return;

      const pending = pendingInputRef.current;
      const transferFocus = pending === document.activeElement;
      const selection = pending ? [pending.selectionStart, pending.selectionEnd] : null;
      const config = latest.current;
      const editorModel = monaco.editor.createModel(pending?.value ?? config.data, config.language);
      model = editorModel;
      const { modelOptions } = config;
      if (modelOptions) {
        // Shared configuration changes (another editor's options) re-derive
        // every model's options; keep this cell type's indentation.
        const enforce = () => {
          const resolved = editorModel.getOptions() as unknown as Record<string, unknown>;
          if (Object.entries(modelOptions).some(([key, value]) => resolved[key] !== value)) editorModel.updateOptions(modelOptions);
        };
        enforce();
        subscriptions.push(editorModel.onDidChangeOptions(enforce));
      }
      // Create directly in the visible, measured host. The React wrapper creates
      // Monaco inside display:none, which WKWebView can leave at its 5×5 minimum
      // until a native window resize, even when the outer container is correct.
      // The theme is global to Monaco, so create with the current preference
      // rather than flashing every editor back to a default.
      const editor = monaco.editor.create(container, {
        // Monaco's 'prompt' shows a confirm dialog for U+2028/U+2029 (common
        // in pasted text); under Tauri's async confirm it silently deletes them.
        unusualLineTerminators: 'off',
        ...config.options,
        ariaLabel: config.ariaLabel,
        theme: config.theme,
        model,
        dimension: { width, height },
      });
      editorRef.current = editor;
      visibility?.disconnect();
      if (config.appShortcuts) editor.createContextKey(APP_SHORTCUTS_CONTEXT, true);

      const decorations = editor.createDecorationsCollection();
      listen('notch-find', event => {
        const match = (event as CustomEvent<{ start: number; end: number } | null>).detail;
        if (!match) { decorations.clear(); return; }
        // Tell noteFind this host revealed the match itself.
        event.preventDefault();
        const range = toRange(editorModel, match.start, match.end);
        decorations.set([{ range, options: { inlineClassName: 'note-find-match' } }]);
        const scroller = container.closest<HTMLElement>('.editor-content');
        if (scroller) scroller.scrollTop += container.getBoundingClientRect().top - scroller.getBoundingClientRect().top + editor.getTopForPosition(range.startLineNumber, range.startColumn) - scroller.clientHeight / 2;
        editor.revealRangeInCenterIfOutsideViewport(range);
        editor.render(true);
      });
      subscriptions.push({ dispose: () => decorations.clear() });
      listen(READ_SELECTION_EVENT, event => {
        const detail = (event as CustomEvent<ReadSelectionDetail & { offset?: number }>).detail;
        const selected = editor.getSelection();
        if (!detail || !selected) return;
        const start = editorModel.getOffsetAt(selected.getStartPosition());
        const end = editorModel.getOffsetAt(selected.getEndPosition());
        const caret = editorModel.getOffsetAt(selected.getPosition());
        detail.selection = { start, end, caret, value: editor.getValue() };
        detail.offset = caret;
      });
      listen(APPLY_EDIT_EVENT, event => {
        const edit = (event as CustomEvent<CellEdit>).detail;
        if (edit && applyEditorEdit(editor, edit)) event.preventDefault();
      });

      subscriptions.push(
        editor.onDidChangeCursorPosition(event => {
          if (!editor.hasTextFocus()) return;
          const scroller = container.closest<HTMLElement>('.editor-content');
          if (!scroller) return;
          const { lineHeight } = latest.current;
          const y = container.getBoundingClientRect().top - scroller.getBoundingClientRect().top
            + editor.getTopForPosition(event.position.lineNumber, event.position.column) - editor.getScrollTop();
          if (y < 8) scroller.scrollTop += y - 8;
          else if (y + lineHeight > scroller.clientHeight - 8) scroller.scrollTop += y + lineHeight - scroller.clientHeight + 8;
        }),
        editor.onDidContentSizeChange(() => syncEditorHeight(editor)),
        editor.onDidFocusEditorText(() => latest.current.onFocus()),
        editor.onDidChangeModelContent(() => {
          if (!applyingExternalValue.current) latest.current.onChange(editor.getValue());
        }),
        editor.onKeyDown(event => {
          const key = event.browserEvent.key;
          if (key === 'Tab') {
            const { indentOnTab, preferences } = latest.current;
            // Registered before the Emacs extension, which skips prevented keys.
            if (indentOnTab && preferences.keyBinding === 'emacs' && !event.shiftKey && !event.altKey
              && !event.ctrlKey && !event.metaKey && !event.browserEvent.isComposing) {
              editor.trigger('keyboard', 'tab', null);
              event.preventDefault();
              event.stopPropagation();
            }
            return;
          }
          if (key === 'Escape') {
            const { blurOnEscape, preferences } = latest.current;
            // Escape first collapses extra cursors; Vim needs it for modes.
            if (blurOnEscape && preferences.keyBinding !== 'vim' && editor.getSelections()?.length === 1) {
              (document.activeElement as HTMLElement | null)?.blur();
            }
            return;
          }
          if (key !== 'Backspace' && key !== 'ArrowUp' && key !== 'ArrowDown') return;
          const currentModel = editor.getModel();
          const position = editor.getPosition();
          const selections = editor.getSelections() ?? [];
          if (!currentModel || !position) return;
          const lastLine = currentModel.getLineCount();
          // Visual rows: with word wrap, Up/Down inside a wrapped first/last
          // line moves within the line before it leaves the cell.
          const top = key === 'Backspace' ? 0 : editor.getTopForPosition(position.lineNumber, position.column);
          const intent = cellKeyIntent({
            key,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            isComposing: event.browserEvent.isComposing,
            isEmpty: currentModel.getValueLength() === 0,
            selectionEmpty: selections.length === 1 && selections[0]!.isEmpty(),
            onFirstRow: key === 'ArrowUp' && position.lineNumber === 1 && top <= editor.getTopForPosition(1, 1),
            onLastRow: key === 'ArrowDown' && position.lineNumber === lastLine
              && top >= editor.getTopForPosition(lastLine, currentModel.getLineMaxColumn(lastLine)),
          });
          if (intent && runIntent(intent)) event.preventDefault();
        }),
      );
      syncEditorHeight(editor);
      setEditorReady(true);
      layoutEditor();
      container.closest('[data-cell-id]')?.dispatchEvent(new Event('notch-editor-ready'));
      if (transferFocus) {
        if (selection) editor.setSelection(toRange(editorModel, selection[0]!, selection[1]!));
        editor.focus();
      }
    };

    const observer = new ResizeObserver(() => {
      if (editorRef.current) layoutEditor();
      else {
        measurePending();
        createWhenVisible();
      }
    });
    observer.observe(container);
    const visibility = near ? null : new IntersectionObserver(entries => {
      near = entries.some(entry => entry.isIntersecting);
      createWhenVisible();
    }, { root: container.closest<HTMLElement>('.editor-content'), rootMargin: '100% 0px' });
    visibility?.observe(container);
    requestCreateRef.current = createWhenVisible;
    const initialization = loader.init();
    void initialization.then(monaco => {
      if (disposed) return;
      installKeybindingRules(monaco);
      monacoRef.current = monaco;
      createWhenVisible();
    }).catch(error => {
      if (disposed || error?.type === 'cancelation') return;
      console.error('Unable to initialize Monaco editor', error);
      setLoadError(true);
    });
    void document.fonts.ready.then(() => {
      if (!disposed) layoutEditor();
    });
    return () => {
      disposed = true;
      observer.disconnect();
      visibility?.disconnect();
      requestCreateRef.current = null;
      initialization.cancel();
      subscriptions.forEach(subscription => subscription.dispose());
      editorRef.current?.dispose();
      model?.dispose();
      editorRef.current = null;
      monacoRef.current = null;
    };
  }, [layoutEditor, syncEditorHeight, runIntent, measurePending]);

  useEffect(() => {
    if (editorRef.current) monacoRef.current?.editor.setTheme(theme);
  }, [theme, editorReady]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    latest.current.applyPreferences?.(editor, preferences);
  }, [preferences, editorReady]);

  // Pasted and dropped files (images in Markdown) are inserted at the caret, or
  // at the drop point. Capture listeners on the wrapper run before Monaco's own
  // paste/drop handling on its host (which would paste nothing for an image, or
  // insert a file path) and also cover the textarea fallback.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    let unmounted = false;
    const accepted = (files: File[]) => {
      const insertion = latest.current.fileInsertion;
      return insertion ? files.filter(insertion.accepts) : [];
    };
    const insertFiles = async (files: File[]) => {
      const insertion = latest.current.fileInsertion;
      const selected = readCellSelection(wrapper);
      if (!insertion || !selected) return;
      // Keep the paste/drop position before resource storage yields. Moving
      // the cursor while files are saved must not move the insertion, and a
      // multi-file paste should be one undo step in the original file order.
      const edit = await prepareFileEdit(files, selected, file => insertion.text(file));
      if (!unmounted && applyCellEdit(wrapper, edit)) return;
      // The editor went away while the files were stored; keep the insert.
      const value = latest.current.data;
      const { start, end, text } = edit;
      latest.current.onChange(value.slice(0, start) + text + value.slice(end));
    };
    const run = (files: File[]) => {
      void insertFiles(files).catch(error => console.error('Unable to insert file', error));
    };
    const paste = (event: ClipboardEvent) => {
      const files = accepted(Array.from(event.clipboardData?.files ?? []));
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      run(files);
    };
    const dragOver = (event: DragEvent) => {
      if (!latest.current.fileInsertion || !event.dataTransfer?.types.includes('Files')) return;
      // Let Monaco see it too: its drop indicator marks where the file lands.
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };
    const drop = (event: DragEvent) => {
      const files = accepted(Array.from(event.dataTransfer?.files ?? []));
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const editor = editorRef.current;
      if (editor) {
        // Monaco never sees this drop, so end its drag: that removes the drop
        // indicator and resets its enter/leave counter.
        editor.getContainerDomNode().dispatchEvent(new Event('dragend'));
        const target = editor.getTargetAtClientPoint(event.clientX, event.clientY);
        if (target?.position) editor.setPosition(target.position);
        editor.focus();
      } else {
        pendingInputRef.current?.focus();
      }
      run(files);
    };
    wrapper.addEventListener('paste', paste, true);
    wrapper.addEventListener('dragover', dragOver, true);
    wrapper.addEventListener('drop', drop, true);
    return () => {
      unmounted = true;
      wrapper.removeEventListener('paste', paste, true);
      wrapper.removeEventListener('dragover', dragOver, true);
      wrapper.removeEventListener('drop', drop, true);
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    let disposed = false;
    let binding: { dispose(): void } | undefined;
    const attach = async () => {
      if (preferences.keyBinding === 'vim') {
        const { initVimMode } = await loadKeyBinding('vim');
        if (!disposed) binding = initVimMode(editor, statusRef.current!);
      } else if (preferences.keyBinding === 'emacs') {
        const { EmacsExtension } = await loadKeyBinding('emacs');
        if (!disposed) { const mode = new EmacsExtension(editor); mode.start(); binding = mode; }
      }
    };
    void attach().catch(error => console.warn('Keyboard binding failed', error));
    return () => { disposed = true; binding?.dispose(); if (statusRef.current) statusRef.current.textContent = ''; };
  }, [preferences.keyBinding, editorReady]);

  useLayoutEffect(() => {
    if (editorReady) {
      layoutEditor();
      containerRef.current?.closest('[data-cell-id]')?.dispatchEvent(new Event('notch-editor-ready'));
    }
  }, [editorReady, editorHeight, layoutEditor]);

  // Store changes that did not come from typing (assistant inserts, image
  // inserts, undo of cell operations) replace only the span that changed, so
  // the caret and undo history around it stay put.
  useLayoutEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const value = editor.getValue();
    if (data === value) return;
    const change = minimalReplacement(value, data);
    applyingExternalValue.current = true;
    try {
      editor.pushUndoStop();
      editor.executeEdits('notch', [{ range: toRange(model, change.start, change.end), text: change.text, forceMoveMarkers: true }]);
      editor.pushUndoStop();
    } finally {
      applyingExternalValue.current = false;
    }
    layoutEditor();
  }, [data, editorReady, layoutEditor]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model && model.getLanguageId() !== language) {
      monacoRef.current?.editor.setModelLanguage(model, language);
      editorRef.current?.render(true);
    }
  }, [language, editorReady]);

  useLayoutEffect(() => {
    if (!editorReady && wraps) measurePending();
  }, [data, editorReady, wraps, measurePending]);

  useLayoutEffect(() => {
    if (!isFocused) return;
    // A focused cell becomes a Monaco editor even when it is off screen.
    if (!editorRef.current) {
      wantedRef.current = true;
      requestCreateRef.current?.();
    }
    if (!document.activeElement?.closest('.find-bar')) {
      if (editorRef.current) editorRef.current.focus();
      else pendingInputRef.current?.focus();
    }
  }, [isFocused, focusRequest]);

  // Before Monaco exists (or if it cannot load) a plain textarea edits the
  // cell with the same cell-level keys.
  const handlePendingKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    const { selectionStart, selectionEnd, value } = textarea;
    if (event.key === 'Escape') {
      if (blurOnEscape) textarea.blur();
      return;
    }
    const intent = cellKeyIntent({
      key: event.key,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      isComposing: event.nativeEvent.isComposing,
      isEmpty: value === '',
      selectionEmpty: selectionStart === selectionEnd,
      onFirstRow: !value.slice(0, selectionStart).includes('\n'),
      onLastRow: !value.slice(selectionEnd).includes('\n'),
    });
    if (intent && runIntent(intent)) { event.preventDefault(); return; }
    if (event.key === 'Tab' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      document.execCommand('insertText', false, ' '.repeat(Number(modelOptions?.tabSize ?? options.tabSize) || 2));
    }
  };

  // Clicks on the wrapper's own padding (outside Monaco) still edit the cell.
  const handleWrapperMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const target = editorRef.current ?? pendingInputRef.current;
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  const height = editorReady ? editorHeight
    : wraps && pendingHeight !== null ? pendingHeight
      : estimateEditorHeight(data, lineHeight, minHeight, scrollbarReserve);

  return (
    <div ref={wrapperRef} data-code-theme={theme} className={wrapperClassName} style={{ position: 'relative' }} onMouseDown={handleWrapperMouseDown}>
      <div ref={statusRef} className="code-key-status" aria-live="polite" />
      <div ref={containerRef} className="monaco-container" style={{ height: height + 'px' }} />
      {!editorReady && (
        <textarea
          ref={pendingInputRef}
          aria-label={ariaLabel}
          className="cell-editor monaco-pending-input"
          style={{
            position: 'absolute',
            inset: 0,
            fontSize: options.fontSize ? `${options.fontSize}px` : undefined,
            lineHeight: `${lineHeight}px`,
          }}
          wrap={options.wordWrap === 'off' ? 'off' : 'soft'}
          value={data}
          onChange={event => onChange(event.target.value)}
          onFocus={onFocus}
          onKeyDown={handlePendingKeyDown}
          spellCheck={false}
          placeholder={loadError ? 'Editor unavailable; plain-text editing is active.' : ''}
        />
      )}
      {!editorReady && wraps && (
        <div
          ref={pendingMirrorRef}
          className="monaco-pending-mirror"
          aria-hidden="true"
          style={{ fontSize: options.fontSize ? `${options.fontSize}px` : undefined, lineHeight: `${lineHeight}px` }}
        >
          {/* A trailing newline starts a row in a textarea (and Monaco), not in a div. */}
          {data + '\u200b'}
        </div>
      )}
    </div>
  );
}
