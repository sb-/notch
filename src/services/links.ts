const ALLOWED_SCHEME =
  /^(?:https?:\/\/|mailto:|tel:|notch:\/\/|quiver-note-url[:/])/i;

const URL_IN_TEXT =
  /(?:https?:\/\/|mailto:|tel:|notch:\/\/|quiver-note-url[:/]|www\.)[^\s<]+/gi;

const TRAILING_WRAP = new Set(['.', ',', ';', ':', '!', '?', "'", '"']);

export type PasteDecision =
  | { action: 'createLink'; href: string }
  | { action: 'insertHtml'; html: string }
  | { action: 'insertText'; text: string };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function toHref(url: string): string {
  return /^www\./i.test(url) ? `https://${url}` : url;
}

function isLinkableUrl(url: string): boolean {
  if (/^www\./i.test(url)) return url.length > 4 && url.includes('.', 4);
  if (!ALLOWED_SCHEME.test(url)) return false;
  // Require something after the scheme so `https://` alone is not a link.
  return /^(?:https?:\/\/.+|mailto:.+|tel:.+|notch:\/\/.+|quiver-note-url[:/].+)/i.test(url);
}

function splitTrailingPunctuation(token: string): { url: string; trailing: string } {
  let url = token;
  let trailing = '';

  while (url.length > 0) {
    const last = url[url.length - 1];
    if (TRAILING_WRAP.has(last)) {
      trailing = last + trailing;
      url = url.slice(0, -1);
      continue;
    }
    if (last === ')' && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
      trailing = last + trailing;
      url = url.slice(0, -1);
      continue;
    }
    if (last === ']' && (url.match(/\[/g)?.length ?? 0) < (url.match(/\]/g)?.length ?? 0)) {
      trailing = last + trailing;
      url = url.slice(0, -1);
      continue;
    }
    break;
  }

  return { url, trailing };
}

export function parseStandaloneUrl(text: string): { href: string; display: string } | null {
  const display = text.trim();
  if (!display || /\s/.test(display)) return null;
  if (!isLinkableUrl(display)) return null;
  return { href: toHref(display), display };
}

export function htmlContainsAnchor(html: string): boolean {
  return /<a\b[^>]*\bhref\s*=/i.test(html);
}

export function linkHtml(href: string, display: string): string {
  return `<a href="${escapeHtml(href)}">${escapeHtml(display)}</a>`;
}

/** Wrap URLs in `text` with `<a>` tags. Returns null when nothing was linked. */
export function linkifyPlainText(text: string): string | null {
  URL_IN_TEXT.lastIndex = 0;
  if (!URL_IN_TEXT.test(text)) return null;

  URL_IN_TEXT.lastIndex = 0;
  let lastIndex = 0;
  let linked = false;
  const parts: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = URL_IN_TEXT.exec(text)) !== null) {
    const { url, trailing } = splitTrailingPunctuation(match[0]);
    if (match.index > lastIndex) {
      parts.push(escapeHtml(text.slice(lastIndex, match.index)));
    }
    if (isLinkableUrl(url)) {
      parts.push(linkHtml(toHref(url), url));
      if (trailing) parts.push(escapeHtml(trailing));
      linked = true;
    } else {
      parts.push(escapeHtml(match[0]));
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(escapeHtml(text.slice(lastIndex)));
  }

  if (!linked) return null;
  return parts.join('').replace(/\r\n|\r|\n/g, '<br>');
}

export function decideTextCellPaste({
  html,
  text,
  hasSelection,
}: {
  html: string;
  text: string;
  hasSelection: boolean;
}): PasteDecision {
  const url = parseStandaloneUrl(text);
  if (url && hasSelection) {
    return { action: 'createLink', href: url.href };
  }
  if (url && !htmlContainsAnchor(html)) {
    return { action: 'insertHtml', html: linkHtml(url.href, url.display) };
  }
  if (html.trim()) {
    return { action: 'insertHtml', html };
  }
  const linked = linkifyPlainText(text);
  if (linked) {
    return { action: 'insertHtml', html: linked };
  }
  return { action: 'insertText', text };
}
