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

interface SizedImageToken {
  type: string;
  raw: string;
  text: string;
  href: string;
  width: string;
  height: string;
  title: string;
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

// Sized images: `![alt](url =WIDTHxHEIGHT)` (Quiver/Typora style). Plain marked
// drops the whole image when the `=800x` suffix is present (the space breaks its
// built-in image rule), so we re-parse the image ourselves and emit width/height
// attributes. Images without a size suffix fall through to marked's built-in
// image handling (the `image` renderer below).
//
// The pattern is a hand-rolled clone of marked's image rule, composed from
// labeled fragments so each maps to one part of the grammar. Known limits
// (acceptable for this app's resource URLs): alt cannot contain an unescaped
// `]`, href cannot contain spaces, and only double-quoted titles are recognized.
const SIZED_IMAGE_RE = new RegExp(
  '^' + [
    /!\[((?:\\.|[^\]])*)\]/, // ![alt]  (\] escapes ok)  -> group 1: alt text
    /\(\s*<?([^\s>]+)>?/,    // (url  (optional <...>)   -> group 2: href
    /\s+=(\d*)x(\d*)/,       //  =WxH                    -> groups 3, 4: width, height
    /(?:\s+"([^"]*)")?/,     //  "title"  (optional)     -> group 5: title
    /\s*\)/,                 // )
  ].map((part) => part.source).join(''),
);

// Undo CommonMark backslash escapes (e.g. `\]` -> `]`) so the alt text we emit
// matches what marked produces for plain images.
const ESCAPED_PUNCT = /\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/g;
function unescapeMarkdown(text: string): string {
  return text.replace(ESCAPED_PUNCT, '$1');
}

const sizedImage = {
  name: 'sizedImage',
  level: 'inline' as const,
  start(src: string) {
    const i = src.indexOf('![');
    return i < 0 ? undefined : i;
  },
  tokenizer(src: string): SizedImageToken | undefined {
    const match = SIZED_IMAGE_RE.exec(src);
    if (!match) return undefined;
    // Require at least one dimension; `=x` is not a valid size suffix.
    if (!match[3] && !match[4]) return undefined;
    return {
      type: 'sizedImage',
      raw: match[0],
      text: unescapeMarkdown(match[1] ?? ''),
      href: match[2] ?? '',
      width: match[3] ?? '',
      height: match[4] ?? '',
      title: match[5] ?? '',
    };
  },
  renderer(token: SizedImageToken) {
    const src = resolveResourceUrl(token.href);
    const altAttr = token.text ? ` alt="${token.text}"` : '';
    const widthAttr = token.width ? ` width="${token.width}"` : '';
    const heightAttr = token.height ? ` height="${token.height}"` : '';
    const titleAttr = token.title ? ` title="${token.title}"` : '';
    return `<img src="${src}"${altAttr}${widthAttr}${heightAttr}${titleAttr} />`;
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
  extensions: [blockMath, inlineMath, sizedImage],
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
