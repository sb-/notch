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

export default function NoteListItem({ note, isSelected, onClick }: NoteListItemProps) {
  return (
    <div
      className={`note-item ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
    >
      <div className="note-title">
        {note.title || 'Untitled'}
      </div>
      <div className="note-date">{formatDate(note.updatedAt)}</div>
    </div>
  );
}
