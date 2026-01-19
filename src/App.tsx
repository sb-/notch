import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useStore, useLayoutMode, useSidebarVisible } from './store';
import { importQuiverLibrary } from './services/import';
import { exportNoteToMarkdown, exportNoteToHTML, exportNoteToJSON, saveToFile } from './services/export';
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
      toggleSidebar: () => void;
      setLayoutMode: (mode: LayoutMode) => void;
      setEditorViewMode: (mode: EditorViewMode) => void;
    };
  }
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
          directory: true,
          multiple: false,
          title: 'Select Quiver Library (.qvlibrary)',
        });
        if (selected) {
          try {
            const result = await importQuiverLibrary(selected as string);
            alert(`Imported ${result.notebooks} notebooks with ${result.notes} notes.${result.errors.length > 0 ? `\n\nErrors:\n${result.errors.join('\n')}` : ''}`);
            await useStore.getState().loadData();
          } catch (err) {
            alert(`Import failed: ${err}`);
          }
        }
      },
      exportNote: async () => {
        const state = useStore.getState();
        const note = state.notes.find(n => n.id === state.selectedNoteId);
        if (!note) {
          alert('No note selected');
          return;
        }

        const format = prompt('Export format (md/html/json):', 'md');
        if (!format) return;

        let content: string;
        let extension: string;
        switch (format.toLowerCase()) {
          case 'html':
            content = exportNoteToHTML(note);
            extension = 'html';
            break;
          case 'json':
            content = exportNoteToJSON(note);
            extension = 'json';
            break;
          default:
            content = exportNoteToMarkdown(note);
            extension = 'md';
        }

        const savePath = await open({
          directory: true,
          title: 'Select export location',
        });
        if (savePath) {
          const fileName = `${note.title.replace(/[^a-zA-Z0-9]/g, '_')}.${extension}`;
          await saveToFile(`${savePath}/${fileName}`, content);
          alert(`Exported to ${fileName}`);
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
    // Setup keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
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
    </div>
  );
}
