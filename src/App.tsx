import { useEffect, useState } from 'react';
import { open, save, message, ask } from '@tauri-apps/plugin-dialog';
import { useStore, useLayoutMode, useSidebarVisible } from './store';
import { importQuiverLibrary, scanForDuplicates, type ImportProgress } from './services/import';
import { exportNoteToMarkdown, exportNoteToHTML, exportNoteToJSON, exportLibraryToJSON, saveToFile } from './services/export';
import { getNoteBySourceUuid, getNote } from './services/database';
import Sidebar from './components/Sidebar/Sidebar';
import NoteList from './components/NoteList/NoteList';
import NoteEditor from './components/Editor/NoteEditor';
import type { EditorViewMode, LayoutMode } from './types';

// Expose functions to Tauri for menu events
declare global {
  interface Window {
    __NOTCH__: {
      newNote: () => void;
      newNotebook: () => void;
      importLibrary: () => void;
      exportNote: () => void;
      exportLibrary: () => void;
      toggleSidebar: () => void;
      setLayoutMode: (mode: LayoutMode) => void;
      setEditorViewMode: (mode: EditorViewMode) => void;
    };
  }
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const loadData = useStore(state => state.loadData);
  const layoutMode = useLayoutMode();
  const sidebarVisible = useSidebarVisible();

  useEffect(() => {
    loadData()
      .then(() => setLoading(false))
      .catch(err => {
        console.error('Failed to initialize database:', err);
        setError(err.message);
        setLoading(false);
      });

    // Expose functions for Tauri menu events
    window.__NOTCH__ = {
      newNote: () => {
        const state = useStore.getState();
        const notebookId = state.selectedNotebookId || state.notebooks[0]?.id;
        if (notebookId) {
          state.createNote(notebookId);
        }
      },
      newNotebook: () => {
        const name = prompt('Enter notebook name:');
        if (name) {
          useStore.getState().createNotebook(name);
        }
      },
      importLibrary: async () => {
        const selected = await open({
          multiple: false,
          title: 'Select Quiver Library (.qvlibrary)',
          filters: [{
            name: 'Quiver Library',
            extensions: ['qvlibrary']
          }]
        });
        if (!selected) return;

        try {
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

            const shouldContinue = await ask(
              `Found ${duplicates.notebookNames.length} notebook(s) that already exist:\n\n${duplicateMsg}\n\nDo you want to skip these and import only new notebooks?`,
              {
                title: 'Duplicate Notebooks Found',
                kind: 'warning',
                okLabel: 'Skip Duplicates',
                cancelLabel: 'Import All (Create Duplicates)',
              }
            );

            if (shouldContinue === null) {
              // User closed the dialog without choosing
              return;
            }
            skipDuplicates = shouldContinue;
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
          await useStore.getState().loadData();

          // Format result message
          let msg = `Successfully imported ${result.notesImported} notes from ${result.notebooks} notebooks.`;
          if (result.notebooksSkipped > 0) {
            msg += `\n\nSkipped ${result.notebooksSkipped} duplicate notebook(s).`;
          }
          if (result.notesFailed > 0) {
            msg += `\n\nFailed to import ${result.notesFailed} notes:`;
            for (const err of result.errors.slice(0, 10)) {
              msg += `\n• "${err.noteTitle}": ${err.error}`;
            }
            if (result.errors.length > 10) {
              msg += `\n... and ${result.errors.length - 10} more errors`;
            }
          }

          await message(msg, {
            title: result.notesFailed > 0 ? 'Import Completed with Errors' : 'Import Completed',
            kind: result.notesFailed > 0 ? 'warning' : 'info',
          });
        } catch (err) {
          setImportProgress(null);
          await message(`Import failed: ${err}`, { title: 'Import Error', kind: 'error' });
        }
      },
      exportNote: async () => {
        const state = useStore.getState();
        const note = state.notes.find(n => n.id === state.selectedNoteId);
        if (!note) {
          await message('No note selected', { title: 'Export Note', kind: 'error' });
          return;
        }

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
      toggleSidebar: () => {
        useStore.getState().toggleSidebar();
      },
      setLayoutMode: (mode: LayoutMode) => {
        useStore.getState().setLayoutMode(mode);
      },
      setEditorViewMode: (mode: EditorViewMode) => {
        useStore.getState().setEditorViewMode(mode);
      },
    };
  }, [loadData]);

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

      // Check for Quiver note links
      if (href.startsWith('quiver-note-url://') || href.startsWith('quiver-note-url:')) {
        e.preventDefault();
        e.stopPropagation();
        const uuid = href.replace(/^quiver-note-url:\/?\/?/, '');
        console.log('Quiver link, UUID:', uuid);
        const note = await getNoteBySourceUuid(uuid);
        console.log('Found note:', note?.id, note?.title);
        if (note) {
          const state = useStore.getState();
          state.selectNotebook(note.notebookId);
          state.selectNote(note.id);
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
          // Select the notebook first (this loads that notebook's notes)
          await state.selectNotebook(note.notebookId);
          // Then select the note
          state.selectNote(note.id);
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

      if (href.startsWith('quiver-note-url://') || href.startsWith('quiver-note-url:')) {
        const uuid = href.replace(/^quiver-note-url:\/?\/?/, '');
        const note = await getNoteBySourceUuid(uuid);
        if (note) {
          const state = useStore.getState();
          await state.selectNotebook(note.notebookId);
          state.selectNote(note.id);
        }
      } else if (href.startsWith('notch://note/')) {
        const noteId = href.replace('notch://note/', '');
        const note = await getNote(noteId);
        if (note) {
          const state = useStore.getState();
          await state.selectNotebook(note.notebookId);
          state.selectNote(note.id);
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
      // Cmd+Z: Undo (let browser handle it for contentEditable)
      if (e.metaKey && e.key === 'z' && !e.shiftKey) {
        // Don't prevent default - let browser handle undo
        document.execCommand('undo');
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
      <div className="app">
        <div className="empty-state">
          <div className="empty-state-title">Loading...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app">
        <div className="empty-state">
          <div className="empty-state-title">Error</div>
          <div className="empty-state-text">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {sidebarVisible && layoutMode === 'triple' && <Sidebar />}
      {(layoutMode === 'triple' || layoutMode === 'double') && <NoteList />}
      <NoteEditor />
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
