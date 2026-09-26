import { Suspense, lazy, useState, useCallback, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { v4 as uuid } from 'uuid';
import { message } from '@tauri-apps/plugin-dialog';
import { copyCell, readCell } from '../../services/cellClipboard';
import { hasCellHistory } from '../../store';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { useStore, useSelectedNote, useEditorViewMode, useNotebooks } from '../../store';
import CellContainer from './CellContainer';
import FindBar from '../Search/FindBar';
import { copyNoteLink } from '../NoteList/NoteListItem';
import {
  loadResourcesForNote,
  dehydrateResourceHtml,
  createResourceFromBase64,
  bytesToBase64,
  RESOURCE_PROTOCOL,
  getResourceDataUrl,
} from '../../services/resources';
import { sanitizeRichText } from '../../services/html';
import { escapeHtml, formatMarkdownSelection, type FormattingAction } from './formatting';
import { LANGUAGE_OPTIONS, toMonacoLanguage } from './codeLanguages';
import type { CellType, EditorViewMode, Note } from '../../types';

const NotePreview = lazy(() => import('../Preview/NotePreview'));

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
};

const cellTypes: { type: CellType; label: string }[] = [
  { type: 'text', label: 'Text Cell' },
  { type: 'code', label: 'Code Cell' },
  { type: 'markdown', label: 'Markdown Cell' },
  { type: 'latex', label: 'LaTeX Cell' },
  { type: 'diagram', label: 'Diagram Cell' },
];

interface NoteEditorProps {
  showFindBar?: boolean;
  onCloseFindBar?: () => void;
}

export default function NoteEditor({ showFindBar, onCloseFindBar }: NoteEditorProps = {}) {
  const selectedNote = useSelectedNote();
  const lastLoadedNoteRef = useRef<Note | null>(null);
  const notebooks = useNotebooks();
  const editorViewMode = useEditorViewMode();
  const updateNote = useStore(state => state.updateNote);
  const toggleFavorite = useStore(state => state.toggleFavorite);
  const addCell = useStore(state => state.addCell);
  const deleteCell = useStore(state => state.deleteCell);
  const updateCell = useStore(state => state.updateCell);
  const moveCell = useStore(state => state.moveCell);
  const setEditorViewMode = useStore(state => state.setEditorViewMode);
  const tags = useStore(state => state.tags);
  const addTagToNote = useStore(state => state.addTagToNote);
  const removeTagFromNote = useStore(state => state.removeTagFromNote);
  const createTag = useStore(state => state.createTag);
  const toggleAssistant = useStore(state => state.toggleAssistant);
  const assistantVisible = useStore(state => state.assistantVisible);

  const scrollSync = useStore(state => state.scrollSync);
  const navigationIndex = useStore(state => state.navigationIndex);
  const navigationHistory = useStore(state => state.navigationHistory);
  const cellHistoryVersion = useStore(state => state.cellHistoryVersion);
  const storeFocusId = useStore(state => state.focusedCellId);
  const [showCellActions, setShowCellActions] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const syncedPositions = useRef(new WeakMap<HTMLElement, number>());
  const syncScroll = (source: HTMLDivElement, target: HTMLDivElement | null) => {
    if (!scrollSync || editorViewMode !== 'split' || !target) return;
    const expected = syncedPositions.current.get(source);
    syncedPositions.current.delete(source);
    // Ignore the scroll we caused, without depending on animation frames that
    // WKWebView may pause when a native window is in the background.
    if (expected !== undefined && Math.abs(expected - source.scrollTop) < 1) return;
    const extent = source.scrollHeight - source.clientHeight;
    target.scrollTop = extent > 0 ? source.scrollTop / extent * (target.scrollHeight - target.clientHeight) : 0;
    syncedPositions.current.set(target, target.scrollTop);
  };
  const [showCellTypeMenu, setShowCellTypeMenu] = useState(false);
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [showNotebookMenu, setShowNotebookMenu] = useState(false);
  const [focusedCellId, setFocusedCellId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [newTagName, setNewTagName] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const pendingNoteSwitch = Boolean(selectedNote && !selectedNote.bodyLoaded);
  const note = pendingNoteSwitch ? lastLoadedNoteRef.current : selectedNote;
  const showingPreviousNote = Boolean(pendingNoteSwitch && note);

  useEffect(() => {
    if (selectedNote?.bodyLoaded) {
      lastLoadedNoteRef.current = selectedNote;
    }
  }, [selectedNote]);

  useEffect(() => {
    if (showingPreviousNote && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, [showingPreviousNote, selectedNote?.id]);

  // Resolve focus synchronously so the toolbar does not briefly fall back to
  // "Text Cell" while focusedCellId catches up after a note/cell switch.
  const focusedCell = note?.cells.find(c => c.id === focusedCellId) ?? note?.cells[0] ?? null;
  const effectiveFocusedCellId = focusedCell?.id ?? null;
  useEffect(() => {
    if (storeFocusId && note?.cells.some(c => c.id === storeFocusId)) { setFocusedCellId(storeFocusId); setFocusRequest(n => n + 1); }
  }, [cellHistoryVersion]);

  // Mirror the focused cell to the store so other panels (e.g. the assistant)
  // can insert into the cell the user is actually working in.
  const setFocusedCellIdStore = useStore(state => state.setFocusedCellId);
  useEffect(() => {
    setFocusedCellIdStore(effectiveFocusedCellId);
  }, [effectiveFocusedCellId, setFocusedCellIdStore]);
  const currentCellType = focusedCell?.type || 'text';
  const currentCodeLanguage = toMonacoLanguage(focusedCell?.language || 'javascript');
  const hasKnownCodeLanguage = LANGUAGE_OPTIONS.some(option => option.id === currentCodeLanguage);

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (note && !showingPreviousNote) {
        updateNote(note.id, { title: e.target.value });
      }
    },
    [note, showingPreviousNote, updateNote]
  );

  const handleViewModeChange = (mode: EditorViewMode) => {
    setEditorViewMode(mode);
  };

  const handleAddTag = async (tagId: string) => {
    if (note && !showingPreviousNote) {
      const tag = tags.find(t => t.id === tagId);
      if (tag && !note.tags.includes(tag.name)) {
        await addTagToNote(note.id, tagId);
      }
    }
    setShowTagMenu(false);
  };

  const handleCreateAndAddTag = async () => {
    if (note && !showingPreviousNote && newTagName.trim()) {
      const tag = await createTag(newTagName.trim());
      await addTagToNote(note.id, tag.id);
      setNewTagName('');
      setShowTagMenu(false);
    }
  };

  const handleRemoveTag = async (tagName: string) => {
    if (note && !showingPreviousNote) {
      const tag = tags.find(t => t.name === tagName);
      if (tag) {
        await removeTagFromNote(note.id, tag.id);
      }
    }
  };

  const handleMoveToNotebook = async (notebookId: string) => {
    if (note && !showingPreviousNote) {
      await updateNote(note.id, { notebookId });
    }
    setShowNotebookMenu(false);
  };

  const handleCellTypeChange = async (type: CellType) => {
    if (note && !showingPreviousNote && effectiveFocusedCellId) {
      const convertCell = useStore.getState().convertCell;
      await convertCell(note.id, effectiveFocusedCellId, type);
    }
    setShowCellTypeMenu(false);
  };

  const handleCodeLanguageChange = async (language: string) => {
    if (note && !showingPreviousNote && effectiveFocusedCellId && currentCellType === 'code') {
      await updateCell(note.id, effectiveFocusedCellId, { language });
    }
  };

  const closeAllMenus = useCallback(() => {
    setShowNotebookMenu(false);
    setShowTagMenu(false);
    setShowCellTypeMenu(false);
    setShowCellActions(false);
  }, []);

  useEffect(() => {
    closeAllMenus();
  }, [selectedNote?.id, closeAllMenus]);

  useEffect(() => {
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAllMenus();
    };
    window.addEventListener('notch-dismiss-menus', closeAllMenus);
    window.addEventListener('blur', closeAllMenus);
    window.addEventListener('keydown', dismissOnEscape);
    return () => {
      window.removeEventListener('notch-dismiss-menus', closeAllMenus);
      window.removeEventListener('blur', closeAllMenus);
      window.removeEventListener('keydown', dismissOnEscape);
    };
  }, [closeAllMenus]);

  const handleDeleteCell = useCallback(async (cellId: string) => {
    if (!note || showingPreviousNote || note.cells.length <= 1) return; // Don't delete the last cell

    const cellIndex = note.cells.findIndex(c => c.id === cellId);
    await deleteCell(note.id, cellId);

    // Focus previous cell, or next if deleting first cell
    const newFocusIndex = cellIndex > 0 ? cellIndex - 1 : 0;
    const remainingCells = note.cells.filter(c => c.id !== cellId);
    if (remainingCells[newFocusIndex]) {
      setFocusedCellId(remainingCells[newFocusIndex].id);
    }
  }, [note, showingPreviousNote, deleteCell]);

  const handleNavigatePrev = useCallback((cellId: string) => {
    if (!note) return;
    const cellIndex = note.cells.findIndex(c => c.id === cellId);
    if (cellIndex > 0) {
      setFocusedCellId(note.cells[cellIndex - 1].id);
    }
  }, [note]);

  const handleNavigateNext = useCallback((cellId: string) => {
    if (!note) return;
    const cellIndex = note.cells.findIndex(c => c.id === cellId);
    if (cellIndex < note.cells.length - 1) {
      setFocusedCellId(note.cells[cellIndex + 1].id);
    }
  }, [note]);

  // Handle Shift+Enter to add new cell
  const handleKeyDown = useCallback(async (e: React.KeyboardEvent) => {
    if (e.shiftKey && e.key === 'Enter' && note && !showingPreviousNote) {
      e.preventDefault();
      e.stopPropagation();
      const afterCellId = effectiveFocusedCellId || note.cells[note.cells.length - 1]?.id;
      // Publish and focus the new input before the next native input event.
      // Persistence continues in the background; edits wait for its insertion.
      let insertion!: Promise<import('../../types').Cell>;
      flushSync(() => {
        insertion = addCell(note.id, currentCellType, afterCellId);
        setFocusedCellId(useStore.getState().focusedCellId);
      });
      await insertion;
    }
  }, [note, showingPreviousNote, effectiveFocusedCellId, currentCellType, addCell]);

  const handleTitleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || !note || showingPreviousNote) return;
    event.preventDefault();
    if (editorViewMode === 'preview') setEditorViewMode('editor');
    setFocusedCellId(note.cells[0]?.id ?? null);
    setFocusRequest(request => request + 1);
  };

  const getFocusedCellElement = useCallback(() => {
    return Array.from(contentRef.current?.querySelectorAll<HTMLElement>('[data-cell-id]') ?? [])
      .find(element => element.dataset.cellId === effectiveFocusedCellId);
  }, [effectiveFocusedCellId]);

  const handleCellAction = useCallback(async (action: string) => {
    if (!note || showingPreviousNote || editorViewMode === 'preview') return;
    const state = useStore.getState();
    if (state.settingsOpen || document.querySelector('[role="dialog"]')) return;
    const cell = note.cells.find(c => c.id === effectiveFocusedCellId);
    if (!cell) return;
    closeAllMenus();
    try {
      const index = note.cells.indexOf(cell);
      if (action === 'undo' || action === 'redo') { await state.undoCellChange(action === 'redo'); return; }
      if (action === 'copy' || action === 'cut') {
        await copyCell(note.id, cell);
        if (action === 'cut') {
          const remaining = note.cells.filter(c => c.id !== cell.id);
          if (!remaining.length) remaining.push({ id: uuid(), type: 'text', data: '', sortOrder: 0 });
          await state.changeCells(note.id, remaining, remaining[Math.max(0, index - 1)]?.id);
        }
      } else if (action === 'paste') {
        const pasted = await readCell(note.id);
        if (!pasted) return;
        const cells = [...note.cells]; cells.splice(index + 1, 0, pasted);
        await state.changeCells(note.id, cells, pasted.id);
        await loadResourcesForNote(note.id);
      } else if (action === 'delete') {
        await handleDeleteCell(cell.id);
      } else if (action === 'up' || action === 'down') {
        await state.moveCell(note.id, cell.id, index + (action === 'up' ? -1 : 1));
      } else if (action === 'split') {
        const element = getFocusedCellElement();
        if (!element) return;
        let before: string, after: string;
        const rich = element.querySelector<HTMLElement>('[contenteditable="true"]');
        if (rich) {
          const selection = window.getSelection();
          if (!selection?.rangeCount || !rich.contains(selection.getRangeAt(0).startContainer)) return;
          const caret = selection.getRangeAt(0);
          const left = caret.cloneRange(); left.selectNodeContents(rich); left.setEnd(caret.startContainer, caret.startOffset);
          const right = caret.cloneRange(); right.selectNodeContents(rich); right.setStart(caret.startContainer, caret.startOffset);
          const div = document.createElement('div'); div.append(left.cloneContents()); before = dehydrateResourceHtml(div.innerHTML);
          div.replaceChildren(right.cloneContents()); after = dehydrateResourceHtml(div.innerHTML);
        } else {
          const detail: { offset?: number } = {};
          // Monaco owns its model selection; other cell types use a textarea.
          const codeHost = element.querySelector('.monaco-container');
          codeHost?.dispatchEvent(new CustomEvent('notch-read-selection', { detail }));
          const textarea = element.querySelector<HTMLTextAreaElement>('textarea:not(.inputarea)');
          const offset = detail.offset ?? textarea?.selectionStart;
          if (offset === undefined) return;
          before = cell.data.slice(0, offset); after = cell.data.slice(offset);
        }
        const next = { ...cell, id: uuid(), data: after };
        const cells = [...note.cells]; cells.splice(index, 1, { ...cell, data: before }, next);
        await state.changeCells(note.id, cells, next.id);
      }
    } catch (error) {
      await message(String(error), { title: 'Cell operation failed', kind: 'error' });
    }
  }, [note, showingPreviousNote, editorViewMode, effectiveFocusedCellId, getFocusedCellElement, closeAllMenus, handleDeleteCell]);

  useEffect(() => {
    const handle = (event: Event) => { void handleCellAction((event as CustomEvent<string>).detail); };
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.altKey || event.shiftKey || event.isComposing) return;
      if (!(event.target as HTMLElement).closest('[data-cell-id]')) return;
      const action = ({ Enter: 'split', NumpadEnter: 'split', KeyX: 'cut', KeyC: 'copy', KeyV: 'paste' } as Record<string, string>)[event.code];
      if (!action) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void handleCellAction(action);
    };
    window.addEventListener('notch-cell-action', handle);
    window.addEventListener('keydown', shortcut, true);
    return () => { window.removeEventListener('notch-cell-action', handle); window.removeEventListener('keydown', shortcut, true); };
  }, [handleCellAction]);

  const handleFormat = async (action: FormattingAction) => {
    if (!note || showingPreviousNote || !focusedCell) return;
    const element = getFocusedCellElement();
    if (focusedCell.type === 'markdown') {
      const textarea = element?.querySelector<HTMLTextAreaElement>('textarea');
      if (!textarea) return;
      const result = formatMarkdownSelection(textarea.value, textarea.selectionStart, textarea.selectionEnd, action);
      // Native insertText creates a real undo transaction in WebKit. Assigning
      // a controlled textarea value bypasses (and can clear) that history.
      textarea.focus();
      let start = 0;
      while (start < textarea.value.length && textarea.value[start] === result.data[start]) start++;
      let end = textarea.value.length;
      let replacementEnd = result.data.length;
      while (end > start && replacementEnd > start && textarea.value[end - 1] === result.data[replacementEnd - 1]) {
        end--; replacementEnd--;
      }
      textarea.setSelectionRange(start, end);
      document.execCommand('insertText', false, result.data.slice(start, replacementEnd));
      textarea.setSelectionRange(result.start, result.end);
    } else if (focusedCell.type === 'text') {
      const editor = element?.querySelector<HTMLElement>('[contenteditable="true"]');
      if (!editor) return;
      editor.focus();
      const commands: Partial<Record<FormattingAction, string>> = {
        bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikeThrough',
        bullet: 'insertUnorderedList', numbered: 'insertOrderedList', rule: 'insertHorizontalRule',
      };
      if (action === 'code') {
        document.execCommand('insertHTML', false, `<code>${escapeHtml(window.getSelection()?.toString() || '\u200b')}</code>`);
      } else if (action === 'h1' || action === 'h2' || action === 'h3') {
        document.execCommand('formatBlock', false, action);
      } else if (commands[action]) {
        document.execCommand(commands[action]!);
      }
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  // Create default cell if note has no cells, and auto-focus first cell
  useEffect(() => {
    if (note?.bodyLoaded) {
      if (note.cells.length === 0) {
        addCell(note.id, 'text').then(cell => {
          setFocusedCellId(cell.id);
        });
      } else if (!focusedCellId || !note.cells.find(c => c.id === focusedCellId)) {
        // Auto-focus first cell if no cell is focused
        setFocusedCellId(note.cells[0].id);
      }
    }
  }, [note?.id, note?.bodyLoaded, note?.cells.length, addCell, focusedCellId]);

  // Load this note's image/attachment resources into the render cache.
  useEffect(() => {
    if (note?.id && note.bodyLoaded) {
      loadResourcesForNote(note.id);
    }
  }, [note?.id, note?.bodyLoaded]);

  // Cmd+Alt+Up / Cmd+Alt+Down moves the focused cell. Capture phase so it wins
  // over Monaco/textarea handling regardless of which cell type has focus.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey || !e.altKey) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (!note || showingPreviousNote || !effectiveFocusedCellId) return;
      const index = note.cells.findIndex(c => c.id === effectiveFocusedCellId);
      if (index === -1) return;
      const target = e.key === 'ArrowUp' ? index - 1 : index + 1;
      if (target < 0 || target >= note.cells.length) return;
      e.preventDefault();
      e.stopPropagation();
      moveCell(note.id, effectiveFocusedCellId, target);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [note, showingPreviousNote, effectiveFocusedCellId, moveCell]);

  const handleInsertImage = useCallback(async () => {
    if (!note || showingPreviousNote) return;
    const cellElement = getFocusedCellElement();
    const textEditor = cellElement?.querySelector<HTMLElement>('[contenteditable="true"]');
    const textarea = cellElement?.querySelector<HTMLTextAreaElement>('.markdown-editor-input');
    const selection = window.getSelection();
    const range = textEditor && selection?.rangeCount && textEditor.contains(selection.anchorNode)
      ? selection.getRangeAt(0).cloneRange() : null;
    const textSelection = textarea ? { start: textarea.selectionStart, end: textarea.selectionEnd } : null;
    const selected = await open({
      multiple: false,
      title: 'Insert Image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }],
    });
    if (!selected) return;

    const path = selected as string;
    const name = path.split('/').pop() || 'image';
    const ext = name.split('.').pop()?.toLowerCase() || '';
    const mime = IMAGE_MIME_BY_EXT[ext] || 'application/octet-stream';
    const bytes = await readFile(path);
    const id = await createResourceFromBase64(note.id, name, mime, bytesToBase64(bytes));
    const alt = name.replace(/\.[^.]+$/, '');
    const ref = `![${alt.replace(/[\[\]\\]/g, '\\$&')}](${RESOURCE_PROTOCOL}${id})`;

    const focused = useStore.getState().notes.find(item => item.id === note.id)?.cells.find(c => c.id === effectiveFocusedCellId);
    if (focused && focused.type === 'markdown') {
      const start = textSelection?.start ?? focused.data.length;
      const end = textSelection?.end ?? start;
      const snippet = `\n${ref}\n`;
      await updateCell(note.id, focused.id, { data: focused.data.slice(0, start) + snippet + focused.data.slice(end) });
      requestAnimationFrame(() => {
        if (!textarea?.isConnected) return;
        textarea.focus();
        textarea.setSelectionRange(start + snippet.length, start + snippet.length);
      });
    } else if (focused && focused.type === 'text') {
      const stableImage = `<img src="${RESOURCE_PROTOCOL}${id}" data-resource-id="${id}" alt="${escapeHtml(alt)}">`;
      if (textEditor?.isConnected && useStore.getState().selectedNoteId === note.id) {
        textEditor.focus();
        const currentSelection = window.getSelection();
        const insertionRange = range && textEditor.contains(range.commonAncestorContainer) ? range : document.createRange();
        if (insertionRange !== range) {
          insertionRange.selectNodeContents(textEditor);
          insertionRange.collapse(false);
        }
        currentSelection?.removeAllRanges();
        currentSelection?.addRange(insertionRange);
        const renderedImage = stableImage.replace(`${RESOURCE_PROTOCOL}${id}`, getResourceDataUrl(id) || `${RESOURCE_PROTOCOL}${id}`);
        document.execCommand('insertHTML', false, renderedImage);
        textEditor.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        await updateCell(note.id, focused.id, { data: sanitizeRichText(focused.data + stableImage) });
      }
    } else {
      const cell = await addCell(note.id, 'markdown', effectiveFocusedCellId ?? undefined);
      await updateCell(note.id, cell.id, { data: `${ref}\n` });
      setFocusedCellId(cell.id);
    }
  }, [note, showingPreviousNote, effectiveFocusedCellId, getFocusedCellElement, addCell, updateCell]);

  if (!note) {
    if (pendingNoteSwitch) {
      return (
        <div className="editor">
          <div className="editor-title">
            <input
              type="text"
              className="editor-title-input"
              value={selectedNote?.title ?? ''}
              readOnly
              placeholder="Untitled"
            />
          </div>
          <div className="empty-state">
            <div className="inline-loading-indicator" aria-hidden="true" />
            <div className="empty-state-title">Opening note...</div>
          </div>
        </div>
      );
    }

    return (
      <div className="editor">
        <div className="empty-state">
          <div className="empty-state-title">No note selected</div>
        </div>
      </div>
    );
  }

  const currentNotebook = notebooks.find(nb => nb.id === note.notebookId);
  const availableTags = tags.filter(t => !note.tags.includes(t.name));

  const renderEditor = () => (
    <div className="editor-content" ref={contentRef} onScroll={e => syncScroll(e.currentTarget, previewRef.current)} onKeyDownCapture={handleKeyDown} onClick={closeAllMenus}>
      <div className="cells-container">
        {note.cells.map((cell) => (
          <CellContainer
            key={cell.id}
            noteId={note.id}
            cell={cell}
            isFocused={effectiveFocusedCellId === cell.id}
            focusRequest={focusRequest}
            onFocus={() => setFocusedCellId(cell.id)}
            onDelete={() => handleDeleteCell(cell.id)}
            canDelete={note.cells.length > 1}
            onNavigatePrev={() => handleNavigatePrev(cell.id)}
            onNavigateNext={() => handleNavigateNext(cell.id)}
          />
        ))}
      </div>
    </div>
  );

  const renderPreview = () => (
    <div className="editor-content" ref={previewRef} onScroll={e => syncScroll(e.currentTarget, contentRef.current)}>
      <Suspense fallback={<div className="preview-loading" aria-label="Loading preview" />}>
        <NotePreview note={note} showHeader={false} />
      </Suspense>
    </div>
  );

  return (
    <div className={`editor ${showingPreviousNote ? 'pending-note-switch' : ''}`}>
      {/* Note Metadata Header */}
      <div className="editor-header">
        <div className="editor-header-row">
          {/* Notebook selector */}
          <div className="editor-notebook-select" onClick={() => { setShowNotebookMenu(!showNotebookMenu); setShowTagMenu(false); setShowCellTypeMenu(false); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
            <span>{currentNotebook?.name || 'No Notebook'}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
            {showNotebookMenu && (
              <div className="context-menu" onClick={e => e.stopPropagation()}>
                {notebooks
                  .filter((nb, idx, arr) => arr.findIndex(n => n.name === nb.name) === idx)
                  .map(nb => (
                    <div
                      key={nb.id}
                      className={`context-menu-item ${nb.id === note.notebookId ? 'active' : ''}`}
                      onClick={() => handleMoveToNotebook(nb.id)}
                    >
                      {nb.name}
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Tags */}
          <div className="editor-tags" onClick={() => { setShowTagMenu(!showTagMenu); setShowNotebookMenu(false); setShowCellTypeMenu(false); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
              <line x1="7" y1="7" x2="7.01" y2="7"/>
            </svg>
            {note.tags.length > 0 ? (
              note.tags.map(tagName => (
                <span
                  key={tagName}
                  className="editor-tag"
                  onClick={(e) => e.stopPropagation()}
                >
                  #{tagName}
                  <span
                    className="editor-tag-remove"
                    onClick={(e) => { e.stopPropagation(); handleRemoveTag(tagName); }}
                    title="Remove tag"
                  >×</span>
                </span>
              ))
            ) : (
              <span className="editor-tags-placeholder">click to add tags</span>
            )}
            {showTagMenu && (
              <div className="context-menu" onClick={e => e.stopPropagation()}>
                {availableTags.length > 0 && availableTags.map(tag => (
                  <div key={tag.id} className="context-menu-item" onClick={() => handleAddTag(tag.id)}>
                    #{tag.name}
                  </div>
                ))}
                {availableTags.length > 0 && <div className="context-menu-separator" />}
                <div className="context-menu-input">
                  <input
                    type="text"
                    placeholder="New tag..."
                    value={newTagName}
                    onChange={e => setNewTagName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCreateAndAddTag();
                      e.stopPropagation();
                    }}
                    onClick={e => e.stopPropagation()}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Toolbar row with cell type and formatting */}
        <div className="editor-toolbar">
          <div className="editor-toolbar-left">
            <div className="cell-type-dropdown" onClick={() => { setShowCellTypeMenu(!showCellTypeMenu); setShowNotebookMenu(false); setShowTagMenu(false); }}>
              <span>{cellTypes.find(c => c.type === currentCellType)?.label || 'Text Cell'}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
              {showCellTypeMenu && (
                <div className="context-menu" onClick={e => e.stopPropagation()}>
                  {cellTypes.map(({ type, label }) => (
                    <div
                      key={type}
                      className={`context-menu-item ${currentCellType === type ? 'active' : ''}`}
                      onClick={() => handleCellTypeChange(type)}
                    >
                      {label}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {currentCellType === 'code' ? (
              <div className="editor-code-language">
                <select
                  className="code-lang-select"
                  value={currentCodeLanguage}
                  onChange={e => handleCodeLanguageChange(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  title="Code language"
                  aria-label="Code language"
                >
                  {!hasKnownCodeLanguage && (
                    <option value={currentCodeLanguage}>{focusedCell?.language || 'Plain Text'}</option>
                  )}
                  {LANGUAGE_OPTIONS.map(option => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : currentCellType === 'text' || currentCellType === 'markdown' ? (
              <div className="editor-format-buttons">
                {([
                  ['bold', 'Bold', <strong>B</strong>], ['italic', 'Italic', <em>I</em>],
                  ['underline', 'Underline', <u>U</u>], ['strike', 'Strikethrough', <s>S</s>],
                  ['code', 'Inline Code', '{}'], ['bullet', 'Bullet List', '•≡'],
                  ['numbered', 'Numbered List', '1≡'], ['checkbox', 'Checkbox', '☐'],
                  ['rule', 'Horizontal Rule', '—'], ['h1', 'Heading 1', 'H1'], ['h2', 'Heading 2', 'H2'], ['h3', 'Heading 3', 'H3'],
                ] as const).filter(([action]) => action !== 'checkbox' || currentCellType === 'markdown').map(([action, label, icon]) => (
                  <button key={action} className="format-btn" title={label} aria-label={label}
                    disabled={editorViewMode === 'preview' || showingPreviousNote}
                    onMouseDown={event => event.preventDefault()} onClick={() => handleFormat(action)}>{icon}</button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="editor-toolbar-right">
            <div style={{ position: 'relative' }}>
              <button className="editor-view-btn" aria-label="Cell actions" title="Cell actions" onMouseDown={e => e.preventDefault()}
                disabled={editorViewMode === 'preview'} onClick={() => setShowCellActions(v => !v)}>⋯</button>
              {showCellActions && <div className="context-menu" style={{ right: 0 }}>
                {([['split','Split Cell at Cursor'],['cut','Cut Cell'],['copy','Copy Cell'],['paste','Paste Cell'],
                  ['up','Move Cell Up'],['down','Move Cell Down'],['delete','Delete Cell'],['undo','Undo Cell Change'],['redo','Redo Cell Change']] as const).map(([action,label]) =>
                  <button key={action} className="context-menu-item" onMouseDown={e => e.preventDefault()}
                    disabled={(action === 'undo' || action === 'redo') && !hasCellHistory(note.id, action === 'redo')}
                    onClick={() => void handleCellAction(action)}>{label}</button>)}
              </div>}
            </div>
            {editorViewMode === 'split' && <button className={`editor-view-btn ${scrollSync ? 'active' : ''}`}
              title="Synchronize scrolling" aria-label="Synchronize scrolling" aria-pressed={scrollSync}
              onClick={() => useStore.getState().toggleScrollSync()}>↕</button>}
            <button
              className={`editor-view-btn ${editorViewMode === 'editor' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('editor')}
              title="Editor (⌘4)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button
              className={`editor-view-btn ${editorViewMode === 'preview' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('preview')}
              title="Preview (⌘5)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
            <button
              className={`editor-view-btn ${editorViewMode === 'split' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('split')}
              title="Side by Side (⌘6)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <line x1="12" y1="3" x2="12" y2="21"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Find Bar */}
      {showFindBar && note && onCloseFindBar && (
        <FindBar note={note} onClose={onCloseFindBar} />
      )}

      {/* Title */}
      <div className="editor-title" onClick={closeAllMenus}>
          <input
            type="text"
            className="editor-title-input"
            value={note.title}
            onChange={handleTitleChange}
            onKeyDown={handleTitleKeyDown}
            readOnly={showingPreviousNote}
            placeholder="Untitled"
          />
      </div>

      {/* Content */}
      {editorViewMode === 'editor' && renderEditor()}
      {editorViewMode === 'preview' && renderPreview()}
      {editorViewMode === 'split' && (
        <div className="editor-split">
          <div className="editor-pane">
            {renderEditor()}
          </div>
          <div className="editor-pane">
            {renderPreview()}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="editor-footer">
        <button className="editor-footer-btn" title="Back (⌘[)" aria-label="Back" disabled={navigationIndex <= 0}
          onClick={() => void useStore.getState().navigateHistory(-1)}>‹</button>
        <button className="editor-footer-btn" title="Forward (⌘])" aria-label="Forward" disabled={navigationIndex >= navigationHistory.length - 1}
          onClick={() => void useStore.getState().navigateHistory(1)}>›</button>
        <button className="editor-footer-btn" title="Floating Preview" aria-label="Floating Preview"
          onClick={() => window.dispatchEvent(new CustomEvent('notch-open-preview'))}>▣</button>
        <button className="editor-footer-btn" title="Export PDF…" aria-label="Export PDF"
          onClick={() => window.dispatchEvent(new CustomEvent('notch-open-preview', { detail: 'print' }))}>PDF</button>
        <button
          className={`editor-footer-btn ${note.isFavorite ? 'active' : ''}`}
          onClick={() => toggleFavorite(note.id)}
          title={note.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={note.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </button>
        <button
          className="editor-footer-btn"
          title="Copy Note Link"
          onClick={() => copyNoteLink(note.id, note.title)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
        </button>
        <button
          className="editor-footer-btn"
          title="Insert Image"
          onMouseDown={event => event.preventDefault()}
          onClick={handleInsertImage}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </button>
        <button
          className={`editor-footer-btn ${assistantVisible ? 'active' : ''}`}
          title="Toggle Assistant (⌘J)"
          onClick={() => toggleAssistant()}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
