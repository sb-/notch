import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
/** A Monaco theme, or 'auto' to follow the app's light/dark appearance. */
export type CodeTheme = 'auto' | 'vs-dark' | 'vs' | 'hc-black';
export type MonacoTheme = Exclude<CodeTheme, 'auto'>;
export interface CodePreferences {
  theme: CodeTheme; tabSize: number; lineNumbers: boolean;
  invisibles: boolean; indentGuides: boolean; softTabs: boolean;
  keyBinding: 'default' | 'vim' | 'emacs';
}
export const defaultCodePreferences: CodePreferences = { theme: 'auto', tabSize: 2, lineNumbers: true, invisibles: false, indentGuides: true, softTabs: true, keyBinding: 'default' };
export function parseCodePreferences(value: unknown): CodePreferences {
  const p = (value && typeof value === 'object' ? value : {}) as Partial<CodePreferences>;
  return { ...defaultCodePreferences,
    theme: ['auto', 'vs-dark', 'vs', 'hc-black'].includes(p.theme!) ? p.theme! : defaultCodePreferences.theme,
    tabSize: [2, 4, 8].includes(p.tabSize!) ? p.tabSize! : 2,
    keyBinding: ['default', 'vim', 'emacs'].includes(p.keyBinding!) ? p.keyBinding! : 'default',
    ...Object.fromEntries(['lineNumbers', 'invisibles', 'indentGuides', 'softTabs'].filter(key => typeof p[key as keyof CodePreferences] === 'boolean').map(key => [key, p[key as keyof CodePreferences]])),
  };
}
function read(): CodePreferences { try { return parseCodePreferences(JSON.parse(localStorage.getItem('notch.code') || '{}')); } catch { return defaultCodePreferences; } }
export const useCodePreferences = create<{ preferences: CodePreferences; update: (updates: Partial<CodePreferences>) => void }>((set, get) => ({
  preferences: read(),
  update: updates => { const preferences = parseCodePreferences({ ...get().preferences, ...updates }); localStorage.setItem('notch.code', JSON.stringify(preferences)); set({ preferences }); },
}));
if (typeof window !== 'undefined') window.addEventListener('storage', event => { if (event.key === 'notch.code') useCodePreferences.setState({ preferences: read() }); });

// Monaco has one global theme, shared by code and Markdown cells. 'auto' keeps
// both in step with the app's appearance (the app follows the system setting).
export function resolveCodeTheme(theme: CodeTheme, prefersDark: boolean): MonacoTheme {
  return theme === 'auto' ? (prefersDark ? 'vs-dark' : 'vs') : theme;
}
const DARK_QUERY = '(prefers-color-scheme: dark)';
function darkQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
}
function subscribeAppearance(onChange: () => void): () => void {
  const query = darkQuery();
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}
const prefersDark = () => darkQuery()?.matches ?? false;
export function useResolvedCodeTheme(): MonacoTheme {
  const theme = useCodePreferences(state => state.preferences.theme);
  const dark = useSyncExternalStore(subscribeAppearance, prefersDark, () => false);
  return resolveCodeTheme(theme, dark);
}
