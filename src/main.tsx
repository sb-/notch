import React from 'react';
import { createRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.min.css';
import App from './App';
import PreviewWindow from './components/Preview/PreviewWindow';
import './styles/index.css';

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    {new URLSearchParams(location.search).has('preview')
      ? <PreviewWindow label={new URLSearchParams(location.search).get('preview')!} /> : <App />}
  </React.StrictMode>
);
