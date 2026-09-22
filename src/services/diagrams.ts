import mermaid from 'mermaid';
import { asyncCache } from './asyncCache';
import { diagramSource } from './diagramSource';

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'dark',
  themeVariables: { lineColor: '#c8ccd4', signalColor: '#c8ccd4', primaryTextColor: '#f1f1f3' },
  flowchart: { useMaxWidth: true, htmlLabels: false },
  sequence: { useMaxWidth: true, diagramMarginX: 8, diagramMarginY: 8 },
});
let nextId = 0;

const renderSource = asyncCache(async (code: string) => {
  // Mermaid creates diagnostic SVGs during failures. Confine all temporary
  // output to this node and remove it on either success or failure.
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-10000px;top:0;width:800px;opacity:0;pointer-events:none';
  document.body.appendChild(container);
  try {
    const id = `notch-diagram-${++nextId}`;
    const { svg } = await mermaid.render(id, code, container);
    return { svg, id };
  } finally {
    container.remove();
  }
});

export async function renderDiagram(source: string, type: 'flow' | 'sequence' = 'flow'): Promise<string> {
  if (!source.trim()) return '';
  const { svg, id } = await renderSource(diagramSource(source, type));
  // Cached markup can appear in editor and preview together: keep SVG IDs unique.
  return svg.replaceAll(id, `notch-diagram-${++nextId}`);
}
