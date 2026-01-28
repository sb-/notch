import { useState } from 'react';
import type { Note } from '../../types';

interface NoteListItemProps {
  note: Note;
  isSelected: boolean;
  onClick: () => void;
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
  const html = `<a href="${url}">${title}</a>`;
  const text = `[${title}](${url})`;

  // Use the browser clipboard API to write multiple formats
  const blob = new Blob([html], { type: 'text/html' });
  const textBlob = new Blob([text], { type: 'text/plain' });

  navigator.clipboard.write([
    new ClipboardItem({
      'text/html': blob,
      'text/plain': textBlob,
    })
  ]);
}

export default function NoteListItem({ note, isSelected, onClick }: NoteListItemProps) {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  };

  const handleCopyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    copyNoteLink(note.id, note.title);
    setShowContextMenu(false);
  };

  return (
    <>
      <div
        className={`note-item ${isSelected ? 'selected' : ''}`}
        onClick={onClick}
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
            style={{
              position: 'fixed',
              left: contextMenuPos.x,
              top: contextMenuPos.y,
              zIndex: 1000,
            }}
          >
            <div className="context-menu-item" onClick={handleCopyLink}>
              Copy Note Link
            </div>
          </div>
        </>
      )}
    </>
  );
}
