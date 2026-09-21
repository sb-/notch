import { useMemo, useEffect, useRef } from 'react';
import hljs from 'highlight.js';
import katex from 'katex';
import { renderDiagram } from '../../services/diagrams';
import { escapeHtml } from '../Editor/formatting';
import { renderMarkdown } from '../../services/markdown';
import { sanitizeRichText } from '../../services/html';
import { resolveResourceHtml, useResourceVersion } from '../../services/resources';
import type { Note } from '../../types';

interface NotePreviewProps {
  note: Note;
  showHeader?: boolean;
}

// Add line numbers to code
function addLineNumbers(code: string, highlighted: string): string {
  const lines = code.split('\n');
  const lineCount = lines.length;
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');
  return `<div class="code-with-lines"><div class="line-numbers">${lineNumbers}</div><code>${highlighted}</code></div>`;
}

export default function NotePreview({ note, showHeader = true }: NotePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const resourceVersion = useResourceVersion();

  const content = useMemo(() => {
    return note.cells.map((cell, index) => {
      const key = `cell-${cell.id}-${index}`;

      switch (cell.type) {
        case 'text':
          return (
            <div
              key={key}
              className="preview-cell preview-text cell-richtext"
              dangerouslySetInnerHTML={{
                __html: sanitizeRichText(resolveResourceHtml(cell.data))
              }}
            />
          );

        case 'code':
          const highlighted = cell.language && hljs.getLanguage(cell.language)
            ? hljs.highlight(cell.data, { language: cell.language }).value
            : escapeHtml(cell.data);
          return (
            <div key={key} className="preview-cell preview-code">
              <pre
                className={`hljs language-${cell.language || 'plaintext'}`}
                dangerouslySetInnerHTML={{
                  __html: addLineNumbers(cell.data, highlighted)
                }}
              />
            </div>
          );

        case 'markdown':
          return (
            <div
              key={key}
              className="preview-cell markdown-preview"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(cell.data) }}
            />
          );

        case 'latex':
          try {
            const latexHtml = katex.renderToString(cell.data, {
              displayMode: true,
              throwOnError: false,
              output: 'html',
            });
            return (
              <div
                key={key}
                className="preview-cell latex-preview"
                dangerouslySetInnerHTML={{ __html: latexHtml }}
              />
            );
          } catch {
            return (
              <div key={key} className="preview-cell preview-text">
                <p style={{ color: 'var(--danger-color)' }}>Invalid LaTeX</p>
              </div>
            );
          }

        case 'diagram':
          return (
            <div
              key={key}
              className="preview-cell diagram-preview"
              data-diagram={cell.data}
              data-diagram-type={cell.diagramType || 'flow'}
            />
          );

        default:
          return (
            <div key={key} className="preview-cell preview-text">
              <p>{cell.data}</p>
            </div>
          );
      }
    });
  }, [note.cells, resourceVersion]);

  // Render mermaid diagrams after mount
  useEffect(() => {
    let cancelled = false;
    const renderDiagrams = async () => {
      if (!containerRef.current) return;

      const diagramElements = containerRef.current.querySelectorAll('[data-diagram]');
      for (const el of diagramElements) {
        const code = el.getAttribute('data-diagram');
        if (!code) continue;

        try {
          const svg = await renderDiagram(code, el.getAttribute('data-diagram-type') === 'sequence' ? 'sequence' : 'flow');
          if (!cancelled) el.innerHTML = svg;
        } catch (error) {
          if (!cancelled) {
            el.textContent = error instanceof Error && error.message.startsWith('This Quiver') ? error.message : 'Unable to render diagram. Double-click its cell to check the syntax.';
            el.classList.add('diagram-error');
          }
        }
      }
    };

    renderDiagrams();
    return () => { cancelled = true; };
  }, [note.cells]);

  return (
    <div ref={containerRef} className="note-preview-content">
      {showHeader && <h1 style={{ marginBottom: '24px' }}>{note.title || 'Untitled'}</h1>}
      {showHeader && note.tags.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          {note.tags.map(tag => (
            <span
              key={tag}
              style={{
                display: 'inline-block',
                padding: '2px 8px',
                marginRight: '8px',
                marginBottom: '4px',
                background: 'var(--bg-tertiary)',
                borderRadius: '4px',
                fontSize: '12px',
                color: 'var(--text-secondary)',
              }}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
      <div className="preview-cells">
        {content}
      </div>
    </div>
  );
}
