import { memo, useEffect, useRef } from 'react';
import hljs from 'highlight.js';
import katex from 'katex';
import { renderDiagram } from '../../services/diagrams';
import { escapeHtml } from '../Editor/formatting';
import { renderMarkdown } from '../../services/markdown';
import { sanitizeRichText } from '../../services/html';
import { resolveResourceHtml, useResourceVersion } from '../../services/resources';
import type { Cell, Note } from '../../types';

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

function DiagramPreview({ data, type }: { data: string; type: 'flow' | 'sequence' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    const el = ref.current!;
    el.classList.remove('diagram-error');
    if (!data.trim()) { el.replaceChildren(); return; }
    // Avoid scheduling Mermaid for every character in a burst of input.
    const timer = setTimeout(() => {
      void renderDiagram(data, type).then(svg => {
        if (!cancelled) el.innerHTML = svg;
      }).catch(error => {
        if (!cancelled) {
          el.textContent = error instanceof Error && error.message.startsWith('This Quiver')
            ? error.message : 'Unable to render diagram. Double-click its cell to check the syntax.';
          el.classList.add('diagram-error');
        }
      });
    }, 100);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [data, type]);
  return <div ref={ref} className="preview-cell diagram-preview" />;
}

// Store updates retain unchanged cell objects. Keep expensive Markdown, math,
// syntax highlighting and diagrams out of unrelated keystrokes and title edits.
const PreviewCell = memo(function PreviewCell({ cell }: { cell: Cell; resourceVersion: number }) {
  switch (cell.type) {
    case 'text':
      return (
        <div
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
        <div className="preview-cell preview-code">
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
            className="preview-cell latex-preview"
            dangerouslySetInnerHTML={{ __html: latexHtml }}
          />
        );
      } catch {
        return (
          <div className="preview-cell preview-text">
            <p style={{ color: 'var(--danger-color)' }}>Invalid LaTeX</p>
          </div>
        );
      }
    case 'diagram':
      return <DiagramPreview data={cell.data} type={cell.diagramType || 'flow'} />;
    default:
      return (
        <div className="preview-cell preview-text">
          <p>{cell.data}</p>
        </div>
      );
  }
});

export default function NotePreview({ note, showHeader = true }: NotePreviewProps) {
  const resourceVersion = useResourceVersion();
  return (
    <div className="note-preview-content">
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
        {note.cells.map(cell => <PreviewCell key={cell.id} cell={cell} resourceVersion={resourceVersion} />)}
      </div>
    </div>
  );
}
