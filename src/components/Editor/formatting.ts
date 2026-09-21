export type FormattingAction = 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'bullet' | 'numbered' | 'checkbox' | 'rule' | 'h1' | 'h2' | 'h3';

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Transform the selected range, returning a selection ready for continued typing. */
export function formatMarkdownSelection(data: string, start: number, end: number, action: FormattingAction) {
  const selected = data.slice(start, end);
  const marker = { bold: '**', italic: '*', strike: '~~', code: '`' }[action as 'bold' | 'italic' | 'strike' | 'code'];
  if (marker || action === 'underline') {
    const before = marker || '<u>';
    const after = marker || '</u>';
    return {
      data: data.slice(0, start) + before + selected + after + data.slice(end),
      start: start + before.length,
      end: end + before.length,
    };
  }
  if (action === 'rule') {
    const snippet = `${start > 0 ? '\n\n' : ''}---\n\n`;
    return { data: data.slice(0, start) + snippet + data.slice(end), start: start + snippet.length, end: start + snippet.length };
  }
  const lineStart = start === 0 ? 0 : data.lastIndexOf('\n', start - 1) + 1;
  const lastSelected = end > start && data[end - 1] === '\n' ? end - 1 : end;
  const nextNewline = data.indexOf('\n', lastSelected);
  const lineEnd = nextNewline < 0 ? data.length : nextNewline;
  const prefix = action === 'bullet' ? '- ' : action === 'checkbox' ? '- [ ] ' : action === 'h1' ? '# ' : action === 'h2' ? '## ' : action === 'h3' ? '### ' : '';
  const lines = data.slice(lineStart, lineEnd).split('\n');
  const formatted = lines.map((line, index) => `${action === 'numbered' ? `${index + 1}. ` : prefix}${line}`).join('\n');
  const firstPrefixLength = action === 'numbered' ? 3 : prefix.length;
  return {
    data: data.slice(0, lineStart) + formatted + data.slice(lineEnd),
    start: start === end ? start + firstPrefixLength : lineStart,
    end: start === end ? end + firstPrefixLength : lineStart + formatted.length,
  };
}
