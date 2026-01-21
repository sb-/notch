import { useMemo, useEffect, useRef } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import katex from 'katex';
import mermaid from 'mermaid';
import DOMPurify from 'dompurify';
import type { Note } from '../../types';

// Configure DOMPurify for text cells
const sanitizeConfig: DOMPurify.Config = {
  ALLOWED_TAGS: [
    'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote', 'pre', 'code',
    'a', 'span', 'div',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'hr', 'sub', 'sup',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style'],
  ALLOW_DATA_ATTR: false,
};

interface NotePreviewProps {
  note: Note;
}

// Add line numbers to code
function addLineNumbers(code: string, highlighted: string): string {
  const lines = highlighted.split('\n');
  const lineCount = lines.length;
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');
  return `<div class="code-with-lines"><div class="line-numbers">${lineNumbers}</div><code>${highlighted}</code></div>`;
}

// Configure marked with highlight.js
marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    code(code: string, infostring?: string) {
      const lang = infostring || '';
      let highlighted = code;
      if (lang && hljs.getLanguage(lang)) {
        try {
          highlighted = hljs.highlight(code, { language: lang }).value;
        } catch {
          // Fall through
        }
      }
      return `<pre class="hljs language-${lang || 'plaintext'}">${addLineNumbers(code, highlighted)}</pre>`;
    },
  },
});

export default function NotePreview({ note }: NotePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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
                __html: DOMPurify.sanitize(cell.data, sanitizeConfig)
              }}
            />
          );

        case 'code':
          const highlighted = cell.language && hljs.getLanguage(cell.language)
            ? hljs.highlight(cell.data, { language: cell.language }).value
            : cell.data;
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
          try {
            const html = marked.parse(cell.data) as string;
            return (
              <div
                key={key}
                className="preview-cell markdown-preview"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          } catch {
            return (
              <div key={key} className="preview-cell preview-text">
                <p>{cell.data}</p>
              </div>
            );
          }

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
  }, [note.cells]);

  // Render mermaid diagrams after mount
  useEffect(() => {
    const renderDiagrams = async () => {
      if (!containerRef.current) return;

      const diagramElements = containerRef.current.querySelectorAll('[data-diagram]');
      for (const el of diagramElements) {
        const code = el.getAttribute('data-diagram');
        if (!code) continue;

        try {
          const id = `mermaid-preview-${Math.random().toString(36).substr(2, 9)}`;
          const { svg } = await mermaid.render(id, code);
          el.innerHTML = svg;
        } catch {
          el.innerHTML = '<span style="color: var(--danger-color)">Invalid diagram</span>';
        }
      }
    };

    renderDiagrams();
  }, [note.cells]);

  return (
    <div ref={containerRef} className="note-preview-content">
      <h1 style={{ marginBottom: '24px' }}>{note.title || 'Untitled'}</h1>
      {note.tags.length > 0 && (
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
