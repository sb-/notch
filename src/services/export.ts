import { writeTextFile, mkdir } from '@tauri-apps/plugin-fs';
import { marked } from 'marked';
import hljs from 'highlight.js';
import katex from 'katex';
import type { Note, Cell } from '../types';
import * as db from './database';

// Configure marked
marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * Export a note to Markdown format
 */
export function exportNoteToMarkdown(note: Note): string {
  const lines: string[] = [];

  // Title
  lines.push(`# ${note.title}`);
  lines.push('');

  // Tags
  if (note.tags.length > 0) {
    lines.push(`Tags: ${note.tags.map(t => `#${t}`).join(' ')}`);
    lines.push('');
  }

  // Cells
  for (const cell of note.cells) {
    switch (cell.type) {
      case 'text':
        lines.push(cell.data);
        lines.push('');
        break;

      case 'markdown':
        lines.push(cell.data);
        lines.push('');
        break;

      case 'code':
        lines.push('```' + (cell.language || ''));
        lines.push(cell.data);
        lines.push('```');
        lines.push('');
        break;

      case 'latex':
        lines.push('$$');
        lines.push(cell.data);
        lines.push('$$');
        lines.push('');
        break;

      case 'diagram':
        lines.push('```mermaid');
        lines.push(cell.data);
        lines.push('```');
        lines.push('');
        break;
    }
  }

  return lines.join('\n');
}

/**
 * Export a note to HTML format
 */
export function exportNoteToHTML(note: Note): string {
  const cellsHtml = note.cells.map(cell => renderCellToHTML(cell)).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(note.title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      line-height: 1.6;
      color: #333;
    }
    h1 { margin-bottom: 20px; }
    .tags { color: #666; margin-bottom: 30px; }
    .tag {
      display: inline-block;
      background: #e8e8ed;
      padding: 2px 8px;
      border-radius: 4px;
      margin-right: 8px;
      font-size: 12px;
    }
    pre {
      background: #f5f5f7;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
    }
    code {
      font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
      font-size: 13px;
    }
    .latex-cell {
      text-align: center;
      margin: 20px 0;
    }
    .diagram-cell {
      text-align: center;
      margin: 20px 0;
    }
    blockquote {
      border-left: 3px solid #ddd;
      margin-left: 0;
      padding-left: 20px;
      color: #666;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
    }
    th { background: #f5f5f7; }
  </style>
</head>
<body>
  <h1>${escapeHtml(note.title)}</h1>
  ${note.tags.length > 0 ? `<div class="tags">${note.tags.map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}</div>` : ''}
  ${cellsHtml}
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.6.0/dist/mermaid.min.js"></script>
  <script>mermaid.initialize({ startOnLoad: true });</script>
</body>
</html>`;
}

function renderCellToHTML(cell: Cell): string {
  switch (cell.type) {
    case 'text':
      return `<div class="text-cell"><p>${escapeHtml(cell.data).replace(/\n/g, '<br>')}</p></div>`;

    case 'markdown':
      try {
        return `<div class="markdown-cell">${marked.parse(cell.data)}</div>`;
      } catch {
        return `<div class="text-cell"><p>${escapeHtml(cell.data)}</p></div>`;
      }

    case 'code':
      const highlighted = cell.language && hljs.getLanguage(cell.language)
        ? hljs.highlight(cell.data, { language: cell.language }).value
        : escapeHtml(cell.data);
      return `<div class="code-cell"><pre><code class="hljs language-${cell.language || 'plaintext'}">${highlighted}</code></pre></div>`;

    case 'latex':
      try {
        const latexHtml = katex.renderToString(cell.data, {
          displayMode: true,
          throwOnError: false,
        });
        return `<div class="latex-cell">${latexHtml}</div>`;
      } catch {
        return `<div class="latex-cell"><code>${escapeHtml(cell.data)}</code></div>`;
      }

    case 'diagram':
      return `<div class="diagram-cell"><pre class="mermaid">${escapeHtml(cell.data)}</pre></div>`;

    default:
      return `<div class="text-cell"><p>${escapeHtml(cell.data)}</p></div>`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Export a note to JSON format (portable)
 */
export function exportNoteToJSON(note: Note): string {
  return JSON.stringify({
    version: 1,
    title: note.title,
    tags: note.tags,
    cells: note.cells.map(cell => ({
      type: cell.type,
      data: cell.data,
      language: cell.language,
      diagramType: cell.diagramType,
    })),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }, null, 2);
}

/**
 * Export to Quiver format for interoperability
 */
export async function exportNoteToQuiver(
  note: Note,
  outputPath: string
): Promise<void> {
  const notePath = `${outputPath}/${note.id}.qvnote`;

  // Create note directory
  await mkdir(notePath, { recursive: true });

  // Write meta.json
  const meta = {
    title: note.title,
    uuid: note.id,
    created_at: Math.floor(note.createdAt / 1000),
    updated_at: Math.floor(note.updatedAt / 1000),
    tags: note.tags,
  };
  await writeTextFile(`${notePath}/meta.json`, JSON.stringify(meta, null, 2));

  // Write content.json
  const content = {
    title: note.title,
    cells: note.cells.map(cell => ({
      type: cell.type,
      language: cell.language,
      diagramType: cell.diagramType,
      data: cell.data,
    })),
  };
  await writeTextFile(`${notePath}/content.json`, JSON.stringify(content, null, 2));
}

/**
 * Export an entire notebook to Quiver format
 */
export async function exportNotebookToQuiver(
  notebookId: string,
  outputPath: string
): Promise<void> {
  const notebook = await db.getNotebook(notebookId);
  if (!notebook) throw new Error('Notebook not found');

  const notes = await db.getNotesByNotebook(notebookId);
  const notebookPath = `${outputPath}/${notebook.id}.qvnotebook`;

  // Create notebook directory
  await mkdir(notebookPath, { recursive: true });

  // Write notebook meta.json
  const meta = {
    name: notebook.name,
    uuid: notebook.id,
  };
  await writeTextFile(`${notebookPath}/meta.json`, JSON.stringify(meta, null, 2));

  // Export each note
  for (const note of notes) {
    await exportNoteToQuiver(note, notebookPath);
  }
}

/**
 * Export entire library to JSON backup
 */
export async function exportLibraryToJSON(): Promise<string> {
  const notebooks = await db.getAllNotebooks();
  const tags = await db.getAllTags();

  const notesWithDetails: Note[] = [];
  for (const notebook of notebooks) {
    const notes = await db.getNotesByNotebook(notebook.id);
    notesWithDetails.push(...notes);
  }

  return JSON.stringify({
    version: 1,
    exportedAt: Date.now(),
    notebooks,
    tags,
    notes: notesWithDetails,
  }, null, 2);
}

/**
 * Save content to file
 */
export async function saveToFile(filePath: string, content: string): Promise<void> {
  await writeTextFile(filePath, content);
}
