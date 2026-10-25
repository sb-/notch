// Run with: bun qa/editor-keybindings/serve.ts
const build = await Bun.build({ entrypoints: [`${import.meta.dir}/editor.tsx`], target: 'browser', define: { 'process.env.NODE_ENV': '"development"' } });
if (!build.success) throw new AggregateError(build.logs);
Bun.serve({
  port: 1467,
  hostname: '127.0.0.1',
  fetch(request) {
    const path = new URL(request.url).pathname;
    const asset = build.outputs.find(output => '/' + output.path.split('/').pop() === path);
    if (asset) return new Response(asset);
    if (path.startsWith('/monaco/vs/') && !path.includes('..')) return new Response(Bun.file(`node_modules/monaco-editor/min/${path.slice('/monaco/'.length)}`));
    if (path === '/bindings/vim.js') return new Response(Bun.file('node_modules/monaco-vim/dist/monaco-vim.umd.js'));
    if (path === '/bindings/emacs.js') return new Response(Bun.file('node_modules/monaco-emacs/dist/monaco-emacs.js'));
    return new Response('<!doctype html><title>Editor keybindings</title><link rel="stylesheet" href="/editor.css"><div id="root"></div><script type="module" src="/editor.js"></script>', { headers: { 'Content-Type': 'text/html' } });
  },
});
console.log('Editor regression harness: http://127.0.0.1:1467');
