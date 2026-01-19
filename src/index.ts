import index from './index.html';

Bun.serve({
  port: 1420,
  routes: {
    '/': index,
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log('Notch dev server running at http://localhost:1420');
