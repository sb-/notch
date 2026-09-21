import { loader } from '@monaco-editor/react';

// Served by the dev server and copied into every release. No CDN is required
// for a first launch, including Monaco's language workers and CSS.
loader.config({ paths: { vs: new URL('/monaco/vs', window.location.href).href } });
