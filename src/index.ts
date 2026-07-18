import index from './index.html';

Bun.serve({
  port: 1420,
  routes: {
    '/': index,
  },
  development: {
    // HMR is disabled: the optional assistant bundles LLM provider SDKs
    // (@earendil-works/pi-ai → openai/anthropic/etc.), and the dev server does
    // not code-split, so they land in the eager bundle. Bun's HMR transform
    // currently emits invalid JS for one of those modules ("Invalid
    // destructuring assignment target"), which blanks the whole app. Bun still
    // live-reloads on save without HMR. Production builds are unaffected.
    // Re-enable once the upstream Bun HMR bug is fixed.
    hmr: false,
    console: true,
  },
});

console.log('Notch dev server running at http://localhost:1420');
