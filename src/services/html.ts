import DOMPurify from 'dompurify';
import type { Config } from 'dompurify';

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
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style', 'src', 'alt', 'title', 'width', 'height', 'data-resource-id'],
  ALLOW_DATA_ATTR: false,
  RETURN_TRUSTED_TYPE: false,
  // Allow custom protocols for internal links and resources, plus data:image URLs
  // for embedded images.
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|notch|notch-resource|quiver-note-url):|data:image\/|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
};

export function sanitizeRichText(html: string): string {
  return DOMPurify.sanitize(html, richTextConfig);
}
