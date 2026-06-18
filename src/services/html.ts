import createDOMPurify from 'dompurify';
import type { Config, DOMPurify, UponSanitizeAttributeHook } from 'dompurify';

const domPurify: DOMPurify = typeof createDOMPurify.sanitize === 'function'
  ? createDOMPurify
  : typeof window !== 'undefined'
    ? createDOMPurify(window)
    : createDOMPurify;

const STYLE_VALUE_BLOCKLIST = /(?:url\s*\(|expression\s*\(|-moz-binding|@import|[<>{}])/i;
const TEXT_ALIGN_VALUES = new Set(['left', 'right', 'center', 'justify', 'start', 'end']);
const TEXT_DECORATION_VALUES = new Set(['none', 'underline', 'overline', 'line-through']);
const VERTICAL_ALIGN_VALUES = new Set([
  'baseline',
  'sub',
  'super',
  'text-top',
  'text-bottom',
  'middle',
  'top',
  'bottom',
]);
const WHITE_SPACE_VALUES = new Set(['normal', 'pre', 'pre-wrap', 'pre-line', 'break-spaces']);

function normalizeStyleValue(value: string): string | null {
  const normalized = value
    .replace(/\s*!important\s*$/i, '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!normalized || STYLE_VALUE_BLOCKLIST.test(normalized)) return null;
  return normalized;
}

function sanitizeColorStyle(value: string): string | null {
  const normalized = normalizeStyleValue(value);
  if (!normalized) return null;

  if (/^#[\da-f]{3,8}$/i.test(normalized)) return normalized;
  if (/^(?:rgb|hsl)a?\([\d%.,\s/+.-]+\)$/i.test(normalized)) return normalized;
  if (/^[a-z]+$/i.test(normalized)) return normalized;

  return null;
}

function sanitizeKeywordList(value: string, allowed: Set<string>): string | null {
  const normalized = normalizeStyleValue(value);
  if (!normalized) return null;

  const parts = normalized.toLowerCase().split(/\s+/);
  if (parts.every(part => allowed.has(part))) return parts.join(' ');

  return null;
}

function sanitizeStyleDeclaration(property: string, value: string): string | null {
  const normalizedProperty = property.trim().toLowerCase();

  switch (normalizedProperty) {
    case 'color':
      return sanitizeColorStyle(value);
    case 'font-style': {
      const normalized = normalizeStyleValue(value);
      return normalized && /^(?:normal|italic|oblique(?: [+-]?\d+(?:\.\d+)?deg)?)$/i.test(normalized)
        ? normalized.toLowerCase()
        : null;
    }
    case 'font-weight': {
      const normalized = normalizeStyleValue(value);
      return normalized && /^(?:normal|bold|bolder|lighter|[1-9]00)$/i.test(normalized)
        ? normalized.toLowerCase()
        : null;
    }
    case 'text-align':
      return sanitizeKeywordList(value, TEXT_ALIGN_VALUES);
    case 'text-decoration':
    case 'text-decoration-line':
      return sanitizeKeywordList(value, TEXT_DECORATION_VALUES);
    case 'vertical-align':
      return sanitizeKeywordList(value, VERTICAL_ALIGN_VALUES);
    case 'white-space':
      return sanitizeKeywordList(value, WHITE_SPACE_VALUES);
    default:
      return null;
  }
}

export function sanitizeInlineStyle(style: string): string {
  const sanitized: string[] = [];

  for (const declaration of style.split(';')) {
    const separatorIndex = declaration.indexOf(':');
    if (separatorIndex === -1) continue;

    const property = declaration.slice(0, separatorIndex).trim().toLowerCase();
    const value = sanitizeStyleDeclaration(property, declaration.slice(separatorIndex + 1));
    if (property && value) {
      sanitized.push(`${property}: ${value}`);
    }
  }

  return sanitized.join('; ');
}

const sanitizeRichTextAttribute: UponSanitizeAttributeHook = (_node, hookEvent) => {
  if (hookEvent.attrName.toLowerCase() !== 'style') return;

  const sanitized = sanitizeInlineStyle(hookEvent.attrValue);
  if (sanitized) {
    hookEvent.attrValue = sanitized;
  } else {
    hookEvent.keepAttr = false;
  }
};

if (typeof domPurify.addHook === 'function') {
  domPurify.addHook('uponSanitizeAttribute', sanitizeRichTextAttribute);
}

// Shared sanitizer config for rich-text (HTML) cell content and previews.
// Centralized here so TextCell and NotePreview can't drift apart.
const richTextConfig: Config = {
  ALLOWED_TAGS: [
    'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote', 'pre', 'code',
    'a', 'span', 'div', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'hr', 'sub', 'sup',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'style', 'src', 'alt', 'title', 'data-resource-id'],
  ALLOW_DATA_ATTR: false,
  RETURN_TRUSTED_TYPE: false,
  // Allow custom protocols for internal links and resources, plus data:image URLs
  // for embedded images.
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|notch|notch-resource|quiver-note-url):|data:image\/|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
};

export function sanitizeRichText(html: string): string {
  if (typeof domPurify.sanitize !== 'function') return html;
  return domPurify.sanitize(html, richTextConfig);
}
