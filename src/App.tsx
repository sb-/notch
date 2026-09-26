import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import type { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent } from 'react';
import { openPreview, connectPreviewWindows } from './services/previewWindows';
import { hasCellHistory, flushPendingChanges } from './store';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { open, save, message, ask } from '@tauri-apps/plugin-dialog';
import { useStore, useLayoutMode, useSidebarVisible } from './store';
import { importQuiverLibrary, scanForDuplicates, summarizeImport, type ImportProgress } from './services/import';
import { exportNoteToMarkdown, exportNoteToHTML, exportNoteToJSON, exportLibraryToJSON, saveToFile } from './services/export';
import { getNoteBySourceUuid, getNote, initDatabase, restoreLibrarySnapshot } from './services/database';
import { parseLibraryBackup } from './services/backup';
import { loadResourcesForNote } from './services/resources';
import { checkForUpdates } from './services/updater';
import {
  createLibrary,
  getActiveLibraryId,
  getLibraries,
  libraryFilename,
  markLibraryLocationPrompted,
  openLibrary,
  renameLibrary,
  refreshLibrary,
  setActiveLibraryId,
  shouldPromptForLibraryLocation,
  takePendingLibraryPath,
  type LibraryInfo,
} from './services/libraries';
import Sidebar from './components/Sidebar/Sidebar';
import NoteList from './components/NoteList/NoteList';
import NoteEditor from './components/Editor/NoteEditor';
import SearchOverlay from './components/Search/SearchOverlay';
import SettingsModal from './components/Settings/SettingsModal';
import type { EditorViewMode, LayoutMode } from './types';
import { withMenuDismissal } from './utils/nativeActions';

// Lazy so the assistant (and the pi packages it pulls) only load when shown,
// keeping the core editor lightweight when the assistant is off.
const AssistantPanel = lazy(() => import('./assistant/AssistantPanel'));

const SIDEBAR_WIDTH_KEY = 'notch.sidebarWidth';
const NOTELIST_WIDTH_KEY = 'notch.noteListWidth';
const ASSISTANT_WIDTH_KEY = 'notch.assistantWidth';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function getStoredWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const stored = window.localStorage.getItem(key);
    const parsed = stored ? Number(stored) : fallback;
    return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
  } catch {
    return fallback;
  }
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Expose functions to Tauri for menu events
declare global {
  interface Window {
    __NOTCH__: {
      newNote: () => void;
      newNotebook: () => void;
      duplicateNote: () => void;
      trashNote: () => void;
      restoreNote: () => void;
      newLibrary: () => void;
      openLibrary: () => void;
      openSettings: () => void;
      importLibrary: () => void;
      exportNote: () => void;
      exportLibrary: () => void;
      restoreLibrary: () => void;
      searchAllNotes: () => void;
      findInNote: () => void;
      toggleSidebar: () => void;
      setLayoutMode: (mode: LayoutMode) => void;
      setEditorViewMode: (mode: EditorViewMode) => void;
      checkForUpdates: () => void;
    };
  }
}

export default function App() {
  useEffect(() => {
    const disconnect = connectPreviewWindows();
    let exiting = false;
    const exitListener = listen('notch-request-exit', async () => {
      if (exiting) return;
      exiting = true;
      try {
        await flushPendingChanges();
        await invoke('complete_exit');
      } catch (error) {
        exiting = false;
        await message(`Your latest changes could not be saved. Notch will stay open.\n\n${String(error)}`, { title: 'Could not save changes', kind: 'error' });
      }
    });
    void exitListener.then(() => invoke('prepare_exit_listener'));
    const navigationListener = listen<string>('notch-navigation', event => {
      const state = useStore.getState();
      if (state.settingsOpen || document.querySelector('[role="dialog"]')) return;
      if (event.payload === 'scroll_sync') state.toggleScrollSync();
      else void state.navigateHistory(event.payload === 'navigate_back' ? -1 : 1);
    });

    const open = (event: Event) => { void openPreview((event as CustomEvent).detail === 'print'); };
    const cellsUndo = (event: KeyboardEvent) => {
      const state = useStore.getState();
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z' || !state.lastChangeWasStructural
        || !state.selectedNoteId || state.settingsOpen || document.querySelector('[role="dialog"]')) return;
      if ((event.target as HTMLElement)?.closest('input')) return;
      if (!hasCellHistory(state.selectedNoteId, event.shiftKey)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void state.undoCellChange(event.shiftKey).catch(error => message(String(error), { title: 'Undo failed', kind: 'error' }));
    };
    window.addEventListener('notch-open-preview', open);
    window.addEventListener('keydown', cellsUndo, true);
    return () => { disconnect(); void exitListener.then(fn => fn()); void navigationListener.then(fn => fn()); window.removeEventListener('notch-open-preview', open); window.removeEventListener('keydown', cellsUndo, true); };
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showFindBar, setShowFindBar] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => getStoredWidth(SIDEBAR_WIDTH_KEY, 180, 140, 360));
  const [noteListWidth, setNoteListWidth] = useState(() => getStoredWidth(NOTELIST_WIDTH_KEY, 240, 180, 520));
  const [assistantWidth, setAssistantWidth] = useState(() => getStoredWidth(ASSISTANT_WIDTH_KEY, 320, 260, 560));
  const assistantVisible = useStore(state => state.assistantVisible);
  const [libraries, setLibraries] = useState<LibraryInfo[]>(() => getLibraries());
  const [activeLibraryId, setActiveLibrary] = useState(() => getActiveLibraryId());
  const [isCreateLibraryOpen, setIsCreateLibraryOpen] = useState(false);
  const [newLibraryName, setNewLibraryName] = useState('');
  const [isRenameLibraryOpen, setIsRenameLibraryOpen] = useState(false);
  const [renameLibraryName, setRenameLibraryName] = useState('');
  const newLibraryInputRef = useRef<HTMLInputElement>(null);
  const renameLibraryInputRef = useRef<HTMLInputElement>(null);
  const firstLaunchPromptedRef = useRef(false);
  const loadData = useStore(state => state.loadData);
  const layoutMode = useLayoutMode();
  const sidebarVisible = useSidebarVisible();
  const hasSelectedNote = useStore(state => state.notes.some(note => note.id === state.selectedNoteId));
  const selectedNoteIsTrashed = useStore(state => state.notes.find(note => note.id === state.selectedNoteId)?.isTrashed ?? false);
  const settingsOpen = useStore(state => state.settingsOpen);
  const activeLibrary = libraries.find(library => library.id === activeLibraryId) ?? libraries[0];

  useEffect(() => {
    void invoke('set_note_menu_state', {
      hasNote: hasSelectedNote && !loading && !settingsOpen && !isCreateLibraryOpen && !isRenameLibraryOpen,
      isTrashed: selectedNoteIsTrashed,
    }).catch(err => console.warn('Could not update note menu:', err));
  }, [hasSelectedNote, selectedNoteIsTrashed, loading, settingsOpen, isCreateLibraryOpen, isRenameLibraryOpen]);

  const handleCreateLibrary = useCallback(() => {
    setNewLibraryName('');
    setIsCreateLibraryOpen(true);
  }, []);

  useEffect(() => {
    if (!isCreateLibraryOpen) return;

    requestAnimationFrame(() => {
      newLibraryInputRef.current?.focus();
    });
  }, [isCreateLibraryOpen]);

  const handleRenameLibrary = useCallback(() => {
    if (!activeLibrary?.path) {
      void message('The default library cannot be renamed. Create or open a library first.', {
        title: 'Rename Library',
        kind: 'info',
      });
      return;
    }
    setRenameLibraryName(activeLibrary.name);
    setIsRenameLibraryOpen(true);
  }, [activeLibrary]);

  useEffect(() => {
    if (!isRenameLibraryOpen) return;

    requestAnimationFrame(() => {
      renameLibraryInputRef.current?.focus();
      renameLibraryInputRef.current?.select();
    });
  }, [isRenameLibraryOpen]);

  const activateLibrary = useCallback(async (library: LibraryInfo) => {
    const nextLibraries = getLibraries();
    setLibraries(nextLibraries);
    setActiveLibraryId(library.id);

    if (library.id === activeLibraryId) {
      await loadData(library.dbPath);
      setLoading(false);
      return;
    }

    setActiveLibrary(library.id);
  }, [activeLibraryId, loadData]);

  const createLibraryAtChosenLocation = useCallback(async (name: string): Promise<boolean> => {
    const libraryPath = await save({
      title: 'Create Notch Library',
      defaultPath: libraryFilename(name),
      filters: [
        { name: 'Notch Library', extensions: ['notch'] },
      ],
    });

    if (!libraryPath) return false;

    const library = await createLibrary(name, libraryPath);
    await activateLibrary(library);
    return true;
  }, [activateLibrary]);

  const handleOpenLibraryPath = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);

    try {
      const library = await openLibrary(path);
      await activateLibrary(library);
    } catch (err) {
      setLoading(false);
      await message(`Could not open library: ${getErrorMessage(err)}`, {
        title: 'Open Library',
        kind: 'error',
      });
    }
  }, [activateLibrary]);

  const handleOpenLibrary = useCallback(async () => {
    // A .notch library is a macOS package (registered document type), so it must
    // be picked in file mode with the extension filter — directory mode greys
    // packages out. Mirrors the Quiver .qvlibrary import dialog.
    const selected = await open({
      multiple: false,
      title: 'Open Notch Library (.notch)',
      filters: [{ name: 'Notch Library', extensions: ['notch'] }],
    });

    if (!selected || Array.isArray(selected)) return;
    await handleOpenLibraryPath(selected);
  }, [handleOpenLibraryPath]);

  const startColumnResize = (
    column: 'sidebar' | 'noteList' | 'assistant',
    e: ReactPointerEvent<HTMLDivElement>
  ) => {
    e.preventDefault();

    const startX = e.clientX;
    let startWidth: number;
    let min: number;
    let max: number;
    let storageKey: string;
    let setWidth: (width: number) => void;
    // The assistant sits on the right, so dragging left (negative delta) grows it.
    let dir = 1;
    if (column === 'sidebar') {
      startWidth = sidebarWidth; min = 140; max = 360; storageKey = SIDEBAR_WIDTH_KEY; setWidth = setSidebarWidth;
    } else if (column === 'noteList') {
      startWidth = noteListWidth; min = 180; max = 520; storageKey = NOTELIST_WIDTH_KEY; setWidth = setNoteListWidth;
    } else {
      startWidth = assistantWidth; min = 260; max = 560; storageKey = ASSISTANT_WIDTH_KEY; setWidth = setAssistantWidth; dir = -1;
    }
    let latestWidth = startWidth;

    document.body.classList.add('resizing-column');

    const handlePointerMove = (event: PointerEvent) => {
      latestWidth = clamp(startWidth + dir * (event.clientX - startX), min, max);
      setWidth(latestWidth);
    };

    const stopResize = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      document.body.classList.remove('resizing-column');
      try {
        window.localStorage.setItem(storageKey, String(latestWidth));
      } catch {
        // Ignore storage failures; resizing still works for the current session.
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
  };

  useEffect(() => {
    if (!activeLibrary) return;

    let cancelled = false;
    setLoading(true);

    const loadActiveLibrary = async () => {
      try {
        const libraryToLoad = activeLibrary.path
          ? await refreshLibrary(activeLibrary)
          : activeLibrary;

        if (cancelled) return;

        if (libraryToLoad.path) {
          setLibraries(getLibraries());
        }

        await loadData(libraryToLoad.dbPath);

        if (!cancelled) {
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to initialize database:', err);
          setError(getErrorMessage(err));
          setLoading(false);
        }
      }
    };

    void loadActiveLibrary();

    return () => {
      cancelled = true;
    };
  }, [activeLibrary?.id, activeLibrary?.dbPath, activeLibrary?.path, loadData]);

  useEffect(() => {
    if (!activeLibrary) return;

    // Expose functions for Tauri menu events
    window.__NOTCH__ = withMenuDismissal({
      newNote: () => {
        const state = useStore.getState();
        const notebookId = state.selectedNotebookId || state.notebooks[0]?.id;
        if (notebookId) {
          state.createNote(notebookId);
        }
      },
      newNotebook: async () => {
        const name = prompt('Enter notebook name:');
        if (name?.trim()) {
          const state = useStore.getState();
          const notebook = await state.createNotebook(name.trim());
          await state.selectNotebook(notebook.id);
        }
      },
      duplicateNote: async () => {
        const state = useStore.getState();
        if (!state.selectedNoteId) return;
        try {
          await state.duplicateNote(state.selectedNoteId);
        } catch (err) {
          await message(`Could not duplicate note: ${getErrorMessage(err)}`, { title: 'Duplicate Note', kind: 'error' });
        }
      },
      trashNote: async () => {
        const state = useStore.getState();
        const note = state.notes.find(note => note.id === state.selectedNoteId);
        if (!note || note.isTrashed) return;
        try {
          await state.deleteNote(note.id);
        } catch (err) {
          await message(`Could not move note to Trash: ${getErrorMessage(err)}`, { title: 'Move to Trash', kind: 'error' });
        }
      },
      restoreNote: async () => {
        const state = useStore.getState();
        const note = state.notes.find(note => note.id === state.selectedNoteId);
        if (!note?.isTrashed) return;
        try {
          await state.restoreNote(note.id);
        } catch (err) {
          await message(`Could not restore note: ${getErrorMessage(err)}`, { title: 'Restore Note', kind: 'error' });
        }
      },
      newLibrary: () => {
        handleCreateLibrary();
      },
      openLibrary: () => {
        void handleOpenLibrary();
      },
      openSettings: () => {
        useStore.getState().setSettingsOpen(true);
      },
      importLibrary: async () => {
        try {
          const selected = await invoke<string | null>('select_quiver_library');
          if (!selected) return;
          // Scan for duplicates first
          setImportProgress({
            phase: 'scanning',
            notebooksTotal: 0,
            notebooksCompleted: 0,
            notesTotal: 0,
            notesCompleted: 0,
          });

          const duplicates = await scanForDuplicates(selected as string);
          setImportProgress(null);

          let skipDuplicates = false;

          // If duplicates found, ask user what to do
          if (duplicates.notebookNames.length > 0) {
            const duplicateList = duplicates.notebookNames.slice(0, 5).join(', ');
            const moreCount = duplicates.notebookNames.length - 5;
            const duplicateMsg = moreCount > 0
              ? `${duplicateList}, and ${moreCount} more`
              : duplicateList;

            const duplicateAction = await message(
              `Found ${duplicates.notebookNames.length} notebook(s) that already exist:\n\n${duplicateMsg}\n\nHow should Notch handle them?`,
              {
                title: 'Duplicate Notebooks Found',
                kind: 'warning',
                buttons: {
                  yes: 'Skip Duplicates',
                  no: 'Import All',
                  cancel: 'Cancel Import',
                },
              }
            );

            if (duplicateAction !== 'Skip Duplicates' && duplicateAction !== 'Import All') {
              return;
            }
            skipDuplicates = duplicateAction === 'Skip Duplicates';
          }

          // Start import
          setImportProgress({
            phase: 'scanning',
            notebooksTotal: 0,
            notebooksCompleted: 0,
            notesTotal: 0,
            notesCompleted: 0,
          });

          const result = await importQuiverLibrary(selected as string, {
            skipDuplicates,
            onProgress: (progress) => setImportProgress({ ...progress }),
          });

          setImportProgress(null);
          await useStore.getState().loadData(activeLibrary.dbPath);

          const summary = summarizeImport(result);
          await message(summary.text, { title: summary.title, kind: summary.kind });
        } catch (err) {
          setImportProgress(null);
          await message(`Import failed: ${err}`, { title: 'Import Error', kind: 'error' });
        }
      },
      exportNote: async () => {
        const state = useStore.getState();
        const selectedNoteId = state.selectedNoteId;
        if (!selectedNoteId) {
          await message('No note selected', { title: 'Export Note', kind: 'error' });
          return;
        }
        await state.loadNoteBody(selectedNoteId);

        const note = useStore.getState().notes.find(n => n.id === selectedNoteId);
        if (!note) {
          await message('No note selected', { title: 'Export Note', kind: 'error' });
          return;
        }

        // Ensure embedded images are cached so exports can inline them.
        await loadResourcesForNote(note.id);

        const sanitizedTitle = note.title.replace(/[^a-zA-Z0-9\s-]/g, '_').trim() || 'untitled';
        const savePath = await save({
          title: 'Export Note',
          defaultPath: `${sanitizedTitle}.md`,
          filters: [
            { name: 'Markdown', extensions: ['md'] },
            { name: 'HTML', extensions: ['html'] },
            { name: 'JSON', extensions: ['json'] },
          ],
        });

        if (savePath) {
          const extension = savePath.split('.').pop()?.toLowerCase() || 'md';
          let content: string;
          switch (extension) {
            case 'html':
              content = exportNoteToHTML(note);
              break;
            case 'json':
              content = exportNoteToJSON(note);
              break;
            default:
              content = exportNoteToMarkdown(note);
          }
          await saveToFile(savePath, content);
          await message(`Exported to ${savePath.split('/').pop()}`, { title: 'Export Note' });
        }
      },
      exportLibrary: async () => {
        const savePath = await save({
          title: 'Export Library',
          defaultPath: 'notch-library.json',
          filters: [
            { name: 'JSON', extensions: ['json'] },
          ],
        });

        if (savePath) {
          try {
            const content = await exportLibraryToJSON();
            await saveToFile(savePath, content);
            await message(`Library exported to ${savePath.split('/').pop()}`, { title: 'Export Library' });
          } catch (err) {
            await message(`Export failed: ${err}`, { title: 'Export Error', kind: 'error' });
          }
        }
      },
      restoreLibrary: async () => {
        const previous = activeLibrary;
        let startedRestore = false;
        try {
          const selected = await open({ title: 'Restore Notch Backup', multiple: false,
            filters: [{ name: 'Notch JSON backup', extensions: ['json'] }] });
          if (typeof selected !== 'string') return;
          const snapshot = parseLibraryBackup(await readTextFile(selected));
          const destination = await save({ title: 'Restore into a New Library',
            defaultPath: 'Restored Library.notch', filters: [{ name: 'Notch Library', extensions: ['notch'] }] });
          if (!destination) return;
          startedRestore = true;
          setLoading(true);
          const name = destination.split('/').pop()?.replace(/\.notch$/i, '') || 'Restored Library';
          const restored = await createLibrary(name, destination);
          await initDatabase(restored.dbPath);
          await restoreLibrarySnapshot(snapshot);
          await activateLibrary(restored);
          await message(`Restored ${snapshot.notes.length} notes, including Trash, and ${snapshot.resources.length} resources into ${name}.`, { title: 'Backup Restored' });
        } catch (err) {
          // A failed restore cannot replace the active library or its contents.
          let recoveryError = '';
          try {
            if (startedRestore && previous) {
              setActiveLibraryId(previous.id);
              setActiveLibrary(previous.id);
              setLibraries(getLibraries());
              await loadData(previous.dbPath);
            }
          } catch (rollbackError) {
            recoveryError = `\nThe previous library could not be reopened: ${getErrorMessage(rollbackError)}`;
            setError(recoveryError.trim());
          } finally {
            setLoading(false);
          }
          await message(`Could not restore backup: ${getErrorMessage(err)}${recoveryError}`, { title: 'Restore Failed', kind: 'error' });
        }
      },
      searchAllNotes: () => {
        setShowSearch(true);
        setShowFindBar(false);
      },
      findInNote: () => {
        setShowFindBar(true);
        setShowSearch(false);
      },
      toggleSidebar: () => {
        useStore.getState().toggleSidebar();
      },
      setLayoutMode: (mode: LayoutMode) => {
        useStore.getState().setLayoutMode(mode);
      },
      setEditorViewMode: (mode: EditorViewMode) => {
        useStore.getState().setEditorViewMode(mode);
      },
      checkForUpdates: () => {
        void checkForUpdates(false);
      },
    }, () => window.dispatchEvent(new Event('notch-dismiss-menus')));
  }, [activeLibrary, activateLibrary, handleCreateLibrary, handleOpenLibrary, loadData]);

  // Quietly check for updates shortly after launch.
  useEffect(() => {
    const timer = setTimeout(() => {
      void checkForUpdates(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const handleSelectLibrary = async (libraryId: string) => {
    const library = libraries.find(item => item.id === libraryId);
    if (!library || library.id === activeLibraryId) return;

    setLoading(true);
    setError(null);

    try {
      const libraryToActivate = library.path ? await refreshLibrary(library) : library;
      await activateLibrary(libraryToActivate);
    } catch (err) {
      setLoading(false);
      await message(`Could not open library: ${getErrorMessage(err)}`, {
        title: 'Open Library',
        kind: 'error',
      });
    }
  };

  const closeCreateLibraryDialog = () => {
    setIsCreateLibraryOpen(false);
    setNewLibraryName('');
  };

  const closeRenameLibraryDialog = () => {
    setIsRenameLibraryOpen(false);
    setRenameLibraryName('');
  };

  const handleRenameLibrarySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const name = renameLibraryName.trim();
    if (!name || !activeLibrary) {
      renameLibraryInputRef.current?.focus();
      return;
    }

    try {
      await renameLibrary(activeLibrary, name);
      setLibraries(getLibraries());
      closeRenameLibraryDialog();
    } catch (err) {
      await message(`Could not rename library: ${getErrorMessage(err)}`, {
        title: 'Rename Library',
        kind: 'error',
      });
    }
  };

  const handleCreateLibrarySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const name = newLibraryName.trim();
    if (!name) {
      newLibraryInputRef.current?.focus();
      return;
    }

    setLoading(true);
    setError(null);
    setIsCreateLibraryOpen(false);

    try {
      const created = await createLibraryAtChosenLocation(name);
      if (created) {
        setNewLibraryName('');
      } else {
        setLoading(false);
      }
    } catch (err) {
      setLoading(false);
      setIsCreateLibraryOpen(true);
      await message(`Could not create library: ${getErrorMessage(err)}`, {
        title: 'New Library',
        kind: 'error',
      });
    }
  };

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen<string>('notch-library-opened', event => {
      void handleOpenLibraryPath(event.payload);
      void takePendingLibraryPath().catch(() => null);
    }).then(listener => {
      if (disposed) {
        listener();
      } else {
        unlisten = listener;
      }
    }).catch(err => {
      console.warn('Could not listen for library open events:', err);
    });

    takePendingLibraryPath()
      .then(path => {
        if (!disposed && path) {
          void handleOpenLibraryPath(path);
        }
      })
      .catch(err => {
        console.warn('Could not read pending library path:', err);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handleOpenLibraryPath]);

  useEffect(() => {
    if (loading || error || firstLaunchPromptedRef.current || !shouldPromptForLibraryLocation()) {
      return;
    }

    const hasExistingNotes = useStore.getState().notes.length > 0;
    markLibraryLocationPrompted();
    firstLaunchPromptedRef.current = true;

    if (hasExistingNotes) return;

    ask('Choose where to store your Notch library?', {
      title: 'Library Location',
      kind: 'info',
      okLabel: 'Choose Location',
      cancelLabel: 'Use Default',
    }).then(chooseLocation => {
      if (chooseLocation) {
        setNewLibraryName('Default Library');
        setIsCreateLibraryOpen(true);
      }
    }).catch(err => {
      console.warn('Could not show library location prompt:', err);
    });
  }, [loading, error]);

  useEffect(() => {
    // Intercept all clicks on note links at document level with capture
    const handleLinkClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Walk up to find anchor - could be clicking on text inside the anchor
      let anchor: HTMLAnchorElement | null = null;
      let el: HTMLElement | null = target;
      while (el && !anchor) {
        if (el.tagName === 'A') {
          anchor = el as HTMLAnchorElement;
        }
        el = el.parentElement;
      }

      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href) return;

      console.log('Link clicked:', href, 'target:', target.tagName, 'anchor:', anchor);

      // Check for Quiver note links (various formats: quiver-note-url://UUID, quiver-note-url:UUID, quiver-note-url/UUID)
      if (href.match(/^quiver-note-url[:/]/i)) {
        e.preventDefault();
        e.stopPropagation();
        const uuid = href.replace(/^quiver-note-url:?\/?\/?\/?/i, '');
        console.log('Quiver link, UUID:', uuid);
        try {
          const note = await getNoteBySourceUuid(uuid);
          console.log('Found note:', note?.id, note?.title);
          if (note) {
            const state = useStore.getState();
            await state.selectNote(note.id, true);
          } else {
            console.warn('Quiver note not found for UUID:', uuid);
            await message('Linked note not found. It may not have been part of the imported library.', { title: 'Linked note', kind: 'warning' });
          }
        } catch (err) {
          console.error('Error resolving Quiver link:', err);
          await message(`Could not open linked note: ${err}`, { title: 'Linked note', kind: 'warning' });
        }
        return;
      }

      // Check for Notch note links
      if (href.startsWith('notch://note/')) {
        e.preventDefault();
        e.stopPropagation();
        const noteId = href.replace('notch://note/', '');
        console.log('Notch link, noteId:', noteId);
        // Look up note from database (not store, which may be filtered by notebook)
        const note = await getNote(noteId);
        console.log('Found note:', note?.id, note?.title);
        if (note) {
          const state = useStore.getState();
          await state.selectNote(note.id, true);
        } else {
          console.log('Note not found in database');
        }
        return;
      }
    };

    // Handle custom navigation event from TextCell
    const handleCustomNavigate = async (e: Event) => {
      const { href } = (e as CustomEvent).detail;
      console.log('Custom navigate event:', href);

      if (href.match(/^quiver-note-url[:/]/i)) {
        const uuid = href.replace(/^quiver-note-url:?\/?\/?\/?/i, '');
        try {
          const note = await getNoteBySourceUuid(uuid);
          if (note) {
            const state = useStore.getState();
            await state.selectNote(note.id, true);
          } else {
            console.warn('Quiver note not found for UUID:', uuid);
            await message('Linked note not found. It may not have been part of the imported library.', { title: 'Linked note', kind: 'warning' });
          }
        } catch (err) {
          console.error('Error resolving Quiver link:', err);
          await message(`Could not open linked note: ${err}`, { title: 'Linked note', kind: 'warning' });
        }
      } else if (href.startsWith('notch://note/')) {
        const noteId = href.replace('notch://note/', '');
        const note = await getNote(noteId);
        if (note) {
          const state = useStore.getState();
          await state.selectNote(note.id, true);
        }
      }
    };

    document.addEventListener('click', handleLinkClick, true);
    window.addEventListener('notch-navigate', handleCustomNavigate);
    return () => {
      document.removeEventListener('click', handleLinkClick, true);
      window.removeEventListener('notch-navigate', handleCustomNavigate);
    };
  }, []);

  useEffect(() => {
    // Setup keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Keep app navigation shortcuts from acting on notes behind a dialog.
      if (useStore.getState().settingsOpen || document.querySelector('[role="dialog"], .library-dialog-overlay')) return;
      if (e.metaKey || e.ctrlKey) window.dispatchEvent(new Event('notch-dismiss-menus'));
      // Cmd+Z: Undo (let browser handle it for contentEditable)
      if (e.metaKey && e.key === 'z' && !e.shiftKey) {
        const target = e.target as HTMLElement | null;
        const isEditable = target?.closest('input, textarea, [contenteditable="true"]');
        if (isEditable) return;

        e.preventDefault();
        useStore.getState().undoLastCellConversion().then(undidConversion => {
          if (!undidConversion) {
            document.execCommand('undo');
          }
        });
        return;
      }
      // Cmd+Shift+Z: Redo
      if (e.metaKey && e.key === 'z' && e.shiftKey) {
        document.execCommand('redo');
        return;
      }
      // Cmd+1: Single pane mode
      if (e.metaKey && e.key === '1') {
        e.preventDefault();
        useStore.getState().setLayoutMode('single');
      }
      // Cmd+2: Double pane mode
      if (e.metaKey && e.key === '2') {
        e.preventDefault();
        useStore.getState().setLayoutMode('double');
      }
      // Cmd+3: Triple pane mode
      if (e.metaKey && e.key === '3') {
        e.preventDefault();
        useStore.getState().setLayoutMode('triple');
      }
      // Cmd+0: Toggle sidebar
      if (e.metaKey && e.key === '0') {
        e.preventDefault();
        useStore.getState().toggleSidebar();
      }
      // Cmd+J: Toggle assistant
      if (e.metaKey && e.key === 'j') {
        e.preventDefault();
        useStore.getState().toggleAssistant();
      }
      // Cmd+,: Open settings
      if (e.metaKey && e.key === ',') {
        e.preventDefault();
        useStore.getState().setSettingsOpen(true);
      }
      // Cmd+4: Editor only
      if (e.metaKey && e.key === '4') {
        e.preventDefault();
        useStore.getState().setEditorViewMode('editor');
      }
      // Cmd+5: Preview only
      if (e.metaKey && e.key === '5') {
        e.preventDefault();
        useStore.getState().setEditorViewMode('preview');
      }
      // Cmd+6: Split view
      if (e.metaKey && e.key === '6') {
        e.preventDefault();
        useStore.getState().setEditorViewMode('split');
      }
      // Cmd+Shift+F: Full text search
      if (e.metaKey && e.key === 'f' && e.shiftKey) {
        e.preventDefault();
        setShowSearch(true);
        setShowFindBar(false);
      }
      // Cmd+F: Find in note
      if (e.metaKey && e.key === 'f' && !e.shiftKey) {
        e.preventDefault();
        setShowFindBar(true);
        setShowSearch(false);
      }
      // Cmd+N: New note
      if (e.metaKey && e.key === 'n' && !e.shiftKey) {
        e.preventDefault();
        const state = useStore.getState();
        const notebookId = state.selectedNotebookId || state.notebooks[0]?.id;
        if (notebookId) {
          state.createNote(notebookId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (loading) {
    return (
      <div className="app app-state">
        <div className="loading-state" role="status" aria-live="polite">
          <div className="loading-indicator" aria-hidden="true" />
          <div className="loading-title">Notch</div>
          <div className="loading-text">Opening library...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app app-state">
        <div className="empty-state">
          <div className="empty-state-title">Error</div>
          <div className="empty-state-text">{error}</div>
        </div>
      </div>
    );
  }

  const appStyle = {
    '--sidebar-width': `${sidebarWidth}px`,
    '--notelist-width': `${noteListWidth}px`,
    '--assistant-width': `${assistantWidth}px`,
  } as CSSProperties;

  return (
    <div className={`app${assistantVisible ? ' assistant-open' : ''}`} style={appStyle}>
      {sidebarVisible && layoutMode === 'triple' && (
        <>
          <Sidebar
            libraries={libraries}
            activeLibraryId={activeLibraryId}
            onSelectLibrary={handleSelectLibrary}
            onCreateLibrary={handleCreateLibrary}
            onRenameLibrary={handleRenameLibrary}
            onOpenLibrary={handleOpenLibrary}
            onOpenSettings={() => useStore.getState().setSettingsOpen(true)}
          />
          <div
            className="column-resizer"
            role="separator"
            aria-label="Resize notebooks sidebar"
            aria-orientation="vertical"
            onPointerDown={e => startColumnResize('sidebar', e)}
          />
        </>
      )}
      {(layoutMode === 'triple' || layoutMode === 'double') && (
        <>
          <NoteList
            onOpenSearch={() => {
              setShowSearch(true);
              setShowFindBar(false);
            }}
          />
          <div
            className="column-resizer"
            role="separator"
            aria-label="Resize note list"
            aria-orientation="vertical"
            onPointerDown={e => startColumnResize('noteList', e)}
          />
        </>
      )}
      <NoteEditor showFindBar={showFindBar} onCloseFindBar={() => setShowFindBar(false)} />
      {assistantVisible && (
        <>
          <div
            className="column-resizer"
            role="separator"
            aria-label="Resize assistant panel"
            aria-orientation="vertical"
            onPointerDown={e => startColumnResize('assistant', e)}
          />
          <div className="assistant-column">
            <Suspense fallback={<div className="assistant-loading">Loading assistant…</div>}>
              <AssistantPanel />
            </Suspense>
          </div>
        </>
      )}
      {showSearch && <SearchOverlay onClose={() => setShowSearch(false)} />}
      <SettingsModal />
      {isCreateLibraryOpen && (
        <div className="library-dialog-overlay" onClick={closeCreateLibraryDialog}>
          <form className="library-dialog" onSubmit={handleCreateLibrarySubmit} onClick={e => e.stopPropagation()}>
            <div className="library-dialog-title">New Library</div>
            <label className="library-dialog-label" htmlFor="new-library-name">
              Name
            </label>
            <input
              ref={newLibraryInputRef}
              id="new-library-name"
              className="library-dialog-input"
              type="text"
              value={newLibraryName}
              onChange={e => setNewLibraryName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  closeCreateLibraryDialog();
                }
              }}
            />
            <div className="library-dialog-actions">
              <button type="button" className="library-dialog-button" onClick={closeCreateLibraryDialog}>
                Cancel
              </button>
              <button type="submit" className="library-dialog-button primary" disabled={!newLibraryName.trim()}>
                Create
              </button>
            </div>
          </form>
        </div>
      )}
      {isRenameLibraryOpen && (
        <div className="library-dialog-overlay" onClick={closeRenameLibraryDialog}>
          <form className="library-dialog" onSubmit={handleRenameLibrarySubmit} onClick={e => e.stopPropagation()}>
            <div className="library-dialog-title">Rename Library</div>
            <label className="library-dialog-label" htmlFor="rename-library-name">
              Name
            </label>
            <input
              ref={renameLibraryInputRef}
              id="rename-library-name"
              className="library-dialog-input"
              type="text"
              value={renameLibraryName}
              onChange={e => setRenameLibraryName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  closeRenameLibraryDialog();
                }
              }}
            />
            <div className="library-dialog-actions">
              <button type="button" className="library-dialog-button" onClick={closeRenameLibraryDialog}>
                Cancel
              </button>
              <button type="submit" className="library-dialog-button primary" disabled={!renameLibraryName.trim()}>
                Rename
              </button>
            </div>
          </form>
        </div>
      )}
      {importProgress && (
        <div className="import-overlay">
          <div className="import-modal">
            <div className="import-title">Importing Quiver Library</div>
            <div className="import-status">
              {importProgress.phase === 'scanning' ? (
                'Scanning library...'
              ) : (
                <>
                  <div className="import-notebook">
                    Notebook: {importProgress.currentNotebook || '...'}
                  </div>
                  <div className="import-note">
                    Note: {importProgress.currentNote || '...'}
                  </div>
                  <div className="import-counts">
                    {importProgress.notebooksCompleted} / {importProgress.notebooksTotal} notebooks
                    {' • '}
                    {importProgress.notesCompleted} notes imported
                  </div>
                </>
              )}
            </div>
            <div className="import-spinner" />
          </div>
        </div>
      )}
    </div>
  );
}
