import React, { useState, useRef, useEffect, useMemo } from 'react';
import mermaid from 'mermaid';

interface DiagramCellProps {
  data: string;
  diagramType: 'sequence' | 'flow';
  onChange: (data: string) => void;
  onDiagramTypeChange: (type: 'sequence' | 'flow') => void;
  onFocus: () => void;
  isFocused?: boolean;
  onBackspaceEmpty?: () => void;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
}

// Initialize mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
  flowchart: {
    useMaxWidth: true,
    htmlLabels: true,
  },
  sequence: {
    useMaxWidth: true,
    diagramMarginX: 8,
    diagramMarginY: 8,
  },
});

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
  onBackspaceEmpty,
  onNavigatePrev,
  onNavigateNext,
}: DiagramCellProps) {
  const [isEditing, setIsEditing] = useState(!data);
  const wasEditing = useRef(isEditing);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string>('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const diagramId = useRef(`mermaid-${Math.random().toString(36).substr(2, 9)}`);

  // Render mermaid diagram
  const renderDiagram = useMemo(() => {
    return async (code: string) => {
      if (!code.trim()) {
        setSvg('');
        setError(null);
        return;
      }

      try {
        // Validate the diagram syntax
        await mermaid.parse(code);

        // Render the diagram
        const { svg: renderedSvg } = await mermaid.render(
          diagramId.current,
          code
        );
        setSvg(renderedSvg);
        setError(null);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Invalid diagram syntax';
        setError(message);
        setSvg('');
      }
    };
  }, []);

  useEffect(() => {
    renderDiagram(data);
  }, [data, renderDiagram]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [isEditing]);

  // Auto-enter editing mode when cell becomes focused (for new cells)
  useEffect(() => {
    if (isFocused && !wasEditing.current && !isEditing) {
      setIsEditing(true);
    }
    wasEditing.current = isEditing;
  }, [isFocused, isEditing]);

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

    if (e.key === 'Backspace' && !data.trim() && onBackspaceEmpty) {
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
      if (selectionStart === 0) {
        e.preventDefault();
        onNavigatePrev();
      }
    } else if (e.key === 'ArrowDown' && onNavigateNext) {
      const { selectionStart, selectionEnd } = textarea;
      if (selectionStart === data.length && selectionEnd === data.length) {
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
          value={data}
          onChange={handleChange}
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
      {svg ? (
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <span style={{ color: 'var(--text-tertiary)' }}>
          Click to add {diagramType === 'flow' ? 'flowchart' : 'sequence'} diagram...
        </span>
      )}
    </div>
  );
}
