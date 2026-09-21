import { memo, useEffect, useState } from 'react';
import type { Note } from '../../types';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { useStore } from '../../store';

interface NoteListItemProps {
  note: Note;
  isSelected: boolean;
  onSelect: (noteId: string) => void;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function copyNoteLink(noteId: string, noteTitle?: string) {
  const title = noteTitle || 'Note';
  const url = `notch://note/${noteId}`;

  // Copy as both HTML (for rich text) and plain text (for markdown)
  const escapedTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = `<a href="${url}">${escapedTitle}</a>`;
  const text = `[${title}](${url})`;

  // Use the browser clipboard API to write multiple formats
  const blob = new Blob([html], { type: 'text/html' });
  const textBlob = new Blob([text], { type: 'text/plain' });

  return navigator.clipboard.write([
    new ClipboardItem({
      'text/html': blob,
      'text/plain': textBlob,
    })
  ]);
}

function NoteListItem({ note, isSelected, onSelect }: NoteListItemProps) {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const selectedNoteId = useStore(state => state.selectedNoteId);

  useEffect(() => { setShowContextMenu(false); }, [selectedNoteId, note.isTrashed]);
  useEffect(() => {
    if (!showContextMenu) return;
    const dismiss = () => setShowContextMenu(false);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    window.addEventListener('blur', dismiss);
    window.addEventListener('notch-dismiss-menus', dismiss);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('notch-dismiss-menus', dismiss);
      window.removeEventListener('keydown', onKey);
    };
  }, [showContextMenu]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: Math.max(8, Math.min(e.clientX, window.innerWidth - 205)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - 140)) });
    setShowContextMenu(true);
  };

  const handleCopyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    void copyNoteLink(note.id, note.title).catch(error => message(String(error), { title: 'Could Not Copy Link', kind: 'error' }));
    setShowContextMenu(false);
  };

  const runAction = async (action: 'trash' | 'restore' | 'delete' | 'duplicate') => {
    setShowContextMenu(false);
    try {
      const store = useStore.getState();
      if (action === 'delete') {
        if (!await ask(`Permanently delete “${note.title || 'Untitled'}” and its attachments? This cannot be undone.`,
          { title: 'Delete Note Permanently', kind: 'warning', okLabel: 'Delete Permanently', cancelLabel: 'Cancel' })) return;
        await store.deleteNote(note.id, true);
      } else if (action === 'trash') await store.deleteNote(note.id);
      else if (action === 'restore') await store.restoreNote(note.id);
      else await store.duplicateNote(note.id);
    } catch (error) {
      await message(String(error), { title: 'Could Not Update Note', kind: 'error' });
    }
  };

  return (
    <>
      <div
        className={`note-item ${isSelected ? 'selected' : ''}`}
        onClick={() => onSelect(note.id)}
        onContextMenu={handleContextMenu}
      >
        <div className="note-title">
          {note.title || 'Untitled'}
        </div>
        <div className="note-date">{formatDate(note.updatedAt)}</div>
      </div>
      {showContextMenu && (
        <>
          <div
            className="context-menu-backdrop"
            onClick={() => setShowContextMenu(false)}
          />
          <div
            className="context-menu"
            role="menu"
            aria-label={`Actions for ${note.title || 'Untitled'}`}
            style={{
              position: 'fixed',
              left: contextMenuPos.x,
              top: contextMenuPos.y,
              zIndex: 1000,
            }}
          >
            <div role="menuitem" className="context-menu-item" onClick={handleCopyLink}>
              Copy Note Link
            </div>
            {note.isTrashed ? <>
              <div role="menuitem" className="context-menu-item" onClick={() => void runAction('restore')}>Restore Note</div>
              <div role="menuitem" className="context-menu-item" onClick={() => void runAction('delete')}>Delete Permanently…</div>
            </> : <>
              <div role="menuitem" className="context-menu-item" onClick={() => void runAction('duplicate')}>Duplicate Note</div>
              <div role="menuitem" className="context-menu-item" onClick={() => void runAction('trash')}>Move to Trash</div>
            </>}
          </div>
        </>
      )}
    </>
  );
}

export default memo(NoteListItem);
