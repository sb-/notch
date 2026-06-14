import { Marked } from 'marked';
import hljs from 'highlight.js';
import katex from 'katex';
import { resolveResourceUrl } from './resources';

// A dedicated marked instance so configuration is centralized and can't be
// clobbered by other modules touching the global `marked` singleton.
const md = new Marked();

interface MathToken {
  type: string;
  raw: string;
  text: string;
}

function renderMath(text: string, displayMode: boolean): string {
  try {
    return katex.renderToString(text, {
      displayMode,
      throwOnError: false,
      output: 'html',
      strict: false,
    });
  } catch {
    return displayMode ? `$$${text}$$` : `$${text}$`;
  }
}

// Block math: $$ ... $$ on its own block.
const blockMath = {
  name: 'blockMath',
  level: 'block' as const,
  start(src: string) {
    const i = src.indexOf('$$');
    return i < 0 ? undefined : i;
  },
  tokenizer(src: string): MathToken | undefined {
    const match = /^\$\$([\s\S]+?)\$\$/.exec(src);
    if (!match) return undefined;
    return { type: 'blockMath', raw: match[0], text: match[1].trim() };
  },
  renderer(token: MathToken) {
    return `<div class="katex-block">${renderMath(token.text, true)}</div>`;
  },
};

// Inline math: $ ... $ (single line, not immediately doubled, not currency-ish).
const inlineMath = {
  name: 'inlineMath',
  level: 'inline' as const,
  start(src: string) {
    const i = src.indexOf('$');
    return i < 0 ? undefined : i;
  },
  tokenizer(src: string): MathToken | undefined {
    const match = /^\$(?!\$)((?:\\\$|[^$\n])+?)\$(?!\d)/.exec(src);
    if (!match) return undefined;
    return { type: 'inlineMath', raw: match[0], text: match[1].trim() };
  },
  renderer(token: MathToken) {
    return renderMath(token.text, false);
  },
};

md.use({
  gfm: true,
  breaks: true,
  // Disable auto-linking of raw URLs - only explicit [text](url) links should work.
  tokenizer: {
    url() {
      return undefined;
    },
  },
  extensions: [blockMath, inlineMath],
  renderer: {
    // Preserve notch:// and quiver-note-url:// protocols on links.
    link(href: string, title: string | null | undefined, text: string) {
      const titleAttr = title ? ` title="${title}"` : '';
      return `<a href="${href}"${titleAttr}>${text}</a>`;
    },
    // Resolve embedded resource images to inline data URLs.
    image(href: string, title: string | null | undefined, text: string) {
      const src = resolveResourceUrl(href);
      const titleAttr = title ? ` title="${title}"` : '';
      const altAttr = text ? ` alt="${text}"` : '';
      return `<img src="${src}"${altAttr}${titleAttr} />`;
    },
    code(code: string, infostring?: string) {
      const lang = (infostring || '').trim();
      if (lang && hljs.getLanguage(lang)) {
        try {
          const highlighted = hljs.highlight(code, { language: lang }).value;
          return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
        } catch {
          // Fall through to unhighlighted.
        }
      }
      return `<pre><code class="hljs">${escapeHtml(code)}</code></pre>`;
    },
  },
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Render markdown source to HTML, with inline math and resource images resolved. */
export function renderMarkdown(src: string): string {
  if (!src) return '';
  try {
    return md.parse(src) as string;
  } catch {
    return escapeHtml(src);
  }
}
