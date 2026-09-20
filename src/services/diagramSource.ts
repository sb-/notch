/** Translate Quiver's legacy diagram syntax for display; preserve saved source. */
export function diagramSource(source: string, type: 'flow' | 'sequence' = 'flow'): string {
  const code = source.trim();
  if (!code || /^(?:---|%%|flowchart\b|graph\b|sequenceDiagram\b|classDiagram\b|stateDiagram\b|erDiagram\b|gantt\b|pie\b|mindmap\b|journey\b|gitGraph\b)/.test(code)) return source;
  if (type === 'sequence' || /^(?:Title:|[\w ]+\s*--?>>?\s*[\w ]+:)/m.test(code) && !code.includes('=>')) {
    const lines = ['sequenceDiagram'];
    for (const line of code.split('\n').map(s => s.trim()).filter(Boolean)) {
      if (/^Title:/i.test(line)) { lines.push(`title ${line.slice(6).trim()}`); continue; }
      if (/^participant\s+\w+(?:\s+as\s+.+)?$/i.test(line)) { lines.push(line); continue; }
      const note = line.match(/^Note\s+(left of|right of|over)\s+([\w, ]+):\s*(.*)$/i);
      if (note) { lines.push(`Note ${note[1]!.toLowerCase()} ${note[2]}: ${note[3]}`); continue; }
      const arrow = line.match(/^([\w]+)\s*(--?>>?)\s*([\w]+):\s*(.*)$/);
      if (!arrow) throw new Error('This Quiver sequence uses unsupported syntax. Edit it as Mermaid to render it.');
      const arrows: Record<string, string> = { '->': '->>', '-->': '-->>', '->>': '-)', '-->>': '--)' };
      lines.push(`${arrow[1]}${arrows[arrow[2]!]}${arrow[3]}: ${arrow[4]}`);
    }
    return lines.join('\n');
  }
  if (!/\w+=>/.test(code)) return source;
  const definitions = new Map<string, { kind: string; label: string }>();
  const edges: string[] = [];
  let last: string | undefined;
  for (const raw of code.split('\n')) {
    const line = raw.trim();
    if (!line) { last = undefined; continue; }
    const def = line.match(/^(\w+)=>(start|end|operation|subroutine|condition|inputoutput)(?::\s*(.*))?$/);
    if (def) { last = def[1]!; definitions.set(last, { kind: def[2]!, label: def[3] || def[2]! }); continue; }
    if (line.includes('->')) { edges.push(line); last = undefined; continue; }
    if (last) { definitions.get(last)!.label += ` ${line}`; continue; }
    throw new Error('This Quiver flowchart uses unsupported syntax. Edit it as Mermaid to render it.');
  }
  const result = ['flowchart TD'];
  const brackets: Record<string, [string, string]> = { start: ['([', '])'], end: ['([', '])'], operation: ['[', ']'], subroutine: ['[[', ']]'], condition: ['{', '}'], inputoutput: ['[/', '/]'] };
  for (const [name, node] of definitions) {
    // flowchart.js embeds an optional link after :>; retain the note source.
    const label = (node.label.startsWith('>') ? '' : node.label.split(':>')[0]!).replace(/\|[\w-]+$/, '').trim() || node.kind;
    const escaped = label.replace(/&/g, '&amp;').replace(/"/g, '#quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const [left, right] = brackets[node.kind]!;
    result.push(`${name}${left}"${escaped}"${right}`);
  }
  for (const edge of edges) {
    const nodes = edge.split('->').map(part => part.trim().match(/^(\w+)(?:\(([^)]+)\))?$/));
    if (nodes.some(n => !n || !definitions.has(n[1]!))) throw new Error('Quiver flowchart references an unknown node.');
    for (let i = 0; i < nodes.length - 1; i++) {
      const from = nodes[i]!; const to = nodes[i + 1]!;
      const branch = from[2]?.split(',').find(part => /^(yes|no|true|false)$/.test(part.trim()))?.trim();
      result.push(`${from[1]} -->${branch ? `|${branch}|` : ''} ${to[1]}`);
    }
  }
  return result.join('\n');
}
