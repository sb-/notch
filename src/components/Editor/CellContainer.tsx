import { Suspense, lazy } from 'react';
import { useStore } from '../../store';
import type { Cell } from '../../types';
import TextCell from './cells/TextCell';

const CodeCell = lazy(() => import('./cells/CodeCell'));
const MarkdownCell = lazy(() => import('./cells/MarkdownCell'));
const LatexCell = lazy(() => import('./cells/LatexCell'));
const DiagramCell = lazy(() => import('./cells/DiagramCell'));

interface CellContainerProps {
  noteId: string;
  cell: Cell;
  isFocused: boolean;
  onFocus: () => void;
  onDelete: () => void;
  canDelete: boolean;
  onNavigatePrev: () => void;
  onNavigateNext: () => void;
}

export default function CellContainer({
  noteId,
  cell,
  isFocused,
  onFocus,
  onDelete,
  canDelete,
  onNavigatePrev,
  onNavigateNext,
}: CellContainerProps) {
  const updateCell = useStore(state => state.updateCell);

  const handleDataChange = (data: string) => {
    updateCell(noteId, cell.id, { data });
  };

  const handleDiagramTypeChange = (diagramType: 'sequence' | 'flow') => {
    updateCell(noteId, cell.id, { diagramType });
  };

  const handleBackspaceEmpty = () => {
    if (canDelete && !cell.data.trim()) {
      onDelete();
    }
  };

  const renderCell = () => {
    const commonProps = {
      data: cell.data,
      onChange: handleDataChange,
      onFocus,
      isFocused,
      onBackspaceEmpty: handleBackspaceEmpty,
      onNavigatePrev,
      onNavigateNext,
    };

    switch (cell.type) {
      case 'text':
        return <TextCell {...commonProps} noteId={noteId} />;
      case 'code':
        return (
          <CodeCell
            {...commonProps}
            language={cell.language || 'javascript'}
          />
        );
      case 'markdown':
        return <MarkdownCell {...commonProps} noteId={noteId} />;
      case 'latex':
        return <LatexCell {...commonProps} />;
      case 'diagram':
        return (
          <DiagramCell
            {...commonProps}
            diagramType={cell.diagramType || 'flow'}
            onDiagramTypeChange={handleDiagramTypeChange}
          />
        );
      default:
        return <TextCell {...commonProps} noteId={noteId} />;
    }
  };

  return (
    <div
      className={`cell cell-${cell.type} ${isFocused ? 'focused' : ''}`}
      onClick={onFocus}
    >
      <div className="cell-content">
        <Suspense fallback={<div className="cell-loading" aria-label="Loading cell" />}>
          {renderCell()}
        </Suspense>
      </div>
    </div>
  );
}
