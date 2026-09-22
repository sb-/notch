import React, { useState, useRef, useEffect } from 'react';
import { renderDiagram } from '../../../services/diagrams';

interface DiagramCellProps {
  data: string;
  diagramType: 'sequence' | 'flow';
  onChange: (data: string) => void;
  onDiagramTypeChange: (type: 'sequence' | 'flow') => void;
  onFocus: () => void;
  isFocused?: boolean;
  focusRequest?: number;
  onBackspaceEmpty?: () => void;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
}

const defaultDiagrams = {
  flow: `graph TD
    A[Start] --> B{Is it?}
    B -->|Yes| C[OK]
    B -->|No| D[End]`,
  sequence: `sequenceDiagram
    Alice->>Bob: Hello Bob, how are you?
    Bob-->>Alice: I'm good thanks!`,
};

export default function DiagramCell({
  data,
  diagramType,
  onChange,
  onFocus,
  isFocused,
  focusRequest,
  onBackspaceEmpty,
  onNavigatePrev,
  onNavigateNext,
}: DiagramCellProps) {
  const [isEditing, setIsEditing] = useState(!data);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string>('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (!data.trim()) {
      setSvg('');
      return;
    }
    const timer = setTimeout(() => {
    void renderDiagram(data, diagramType).then(renderedSvg => {
      if (!cancelled) setSvg(renderedSvg);
    }).catch((err: unknown) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Invalid diagram syntax');
        setSvg('');
      }
    });
    }, 100);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [data, diagramType]);

  useEffect(() => {
    if (isEditing && isFocused && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [isEditing, isFocused, focusRequest]);

  // Keyboard navigation (including Return from the title) enters the source editor.
  useEffect(() => {
    if (isFocused) setIsEditing(true);
  }, [isFocused, focusRequest]);

  const handleDoubleClick = () => {
    setIsEditing(true);
    onFocus();
  };

  const handleBlur = () => {
    setIsEditing(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    if (e.key === 'Backspace' && data === '' && onBackspaceEmpty) {
      e.preventDefault();
      onBackspaceEmpty();
      return;
    }
    if (e.key === 'Escape') {
      setIsEditing(false);
    }
    // Arrow key navigation between cells
    if (e.key === 'ArrowUp' && onNavigatePrev) {
      const { selectionStart } = textarea;
      const textBeforeCursor = data.substring(0, selectionStart);
      // Only navigate if we're on the first line (no newline before cursor)
      if (!textBeforeCursor.includes('\n')) {
        e.preventDefault();
        onNavigatePrev();
      }
    } else if (e.key === 'ArrowDown' && onNavigateNext) {
      const { selectionStart } = textarea;
      const textAfterCursor = data.substring(selectionStart);
      // Only navigate if we're on the last line (no newline after cursor)
      if (!textAfterCursor.includes('\n')) {
        e.preventDefault();
        onNavigateNext();
      }
    }
    // Allow Tab for indentation
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = data.substring(0, start) + '  ' + data.substring(end);
      onChange(newValue);
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }, 0);
    }
  };

  const handleInsertTemplate = () => {
    onChange(defaultDiagrams[diagramType]);
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [data, isEditing]);

  if (isEditing) {
    return (
      <div>
        <textarea
          ref={textareaRef}
          className="cell-editor"
          aria-label="Diagram cell"
          value={data}
          onChange={handleChange}
          onFocus={onFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={`Enter Mermaid ${diagramType} diagram syntax...`}
          style={{
            minHeight: '100px',
            fontFamily: 'var(--font-mono)',
          }}
        />
        {!data && (
          <div
            style={{
              padding: '8px 12px',
              borderTop: '1px solid var(--cell-border)',
            }}
          >
            <button
              onClick={handleInsertTemplate}
              style={{
                padding: '4px 12px',
                fontSize: '12px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                cursor: 'pointer',
                color: 'var(--text-primary)',
              }}
            >
              Insert {diagramType === 'flow' ? 'Flowchart' : 'Sequence'} Template
            </button>
          </div>
        )}
        {error && (
          <div
            style={{
              padding: '8px 12px',
              fontSize: '12px',
              color: 'var(--danger-color)',
              background: 'rgba(255, 59, 48, 0.1)',
              borderTop: '1px solid var(--cell-border)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="diagram-preview"
      onDoubleClick={handleDoubleClick}
      onClick={onFocus}
      style={{
        cursor: 'text',
        minHeight: '100px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {error ? (
        <div className="diagram-error" role="alert" style={{ color: 'var(--danger-color)', whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      ) : svg ? (
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <span style={{ color: 'var(--text-tertiary)' }}>
          Click to add {diagramType === 'flow' ? 'flowchart' : 'sequence'} diagram...
        </span>
      )}
    </div>
  );
}
