import { useStore } from '../../store';
import type { Cell } from '../../types';
import TextCell from './cells/TextCell';
import CodeCell from './cells/CodeCell';
import MarkdownCell from './cells/MarkdownCell';
import LatexCell from './cells/LatexCell';
import DiagramCell from './cells/DiagramCell';

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

  const handleLanguageChange = (language: string) => {
    updateCell(noteId, cell.id, { language });
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
        return <TextCell {...commonProps} />;
      case 'code':
        return (
          <CodeCell
            {...commonProps}
            language={cell.language || 'javascript'}
            onLanguageChange={handleLanguageChange}
          />
        );
      case 'markdown':
        return <MarkdownCell {...commonProps} />;
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
        return <TextCell {...commonProps} />;
    }
  };

  return (
    <div
      className={`cell cell-${cell.type} ${isFocused ? 'focused' : ''}`}
      onClick={onFocus}
    >
      <div className="cell-content">{renderCell()}</div>
    </div>
  );
}
