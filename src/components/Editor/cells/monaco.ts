import { loader } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';

// Served by the dev server and copied into every release. No CDN is required
// for a first launch, including Monaco's language workers and CSS.
loader.config({ paths: { vs: new URL('/monaco/vs', window.location.href).href } });

// Load keyboard extensions through the same AMD runtime as the editor. This
// avoids shipping a second Monaco instance (and keeps first-load work lazy).
let configured = false;
export async function loadKeyBinding(name: 'vim' | 'emacs'): Promise<any> {
  const monaco = await loader.init();
  const runtime = window as any;
  if (!configured) {
    runtime.define('monaco-editor/esm/vs/editor/editor.api', [], () => monaco);
    runtime.require.config({ paths: { 'notch-vim': '/bindings/vim', 'notch-emacs': '/bindings/emacs' } });
    configured = true;
  }
  return new Promise((resolve, reject) => runtime.require([`notch-${name}`], resolve, reject));
}

/**
 * Editor context key set on editors whose app shortcuts win over Monaco's
 * defaults: Cmd+F opens the note Find bar and Cmd+[ / Cmd+] go Back/Forward
 * (native menu accelerators), instead of Monaco's find widget and line indent.
 */
export const APP_SHORTCUTS_CONTEXT = 'notchAppShortcuts';

// Keybinding rules are global to Monaco, so the defaults are re-registered with
// a `when` clause that excludes editors carrying APP_SHORTCUTS_CONTEXT; other
// editors (code cells) keep Monaco's behaviour.
let rulesInstalled = false;
export function installKeybindingRules(monaco: typeof Monaco): void {
  if (rulesInstalled) return;
  rulesInstalled = true;
  const { KeyMod, KeyCode } = monaco;
  const notApp = `!${APP_SHORTCUTS_CONTEXT}`;
  const rebind = (keybinding: number, command: string, when: string) => [
    { keybinding, command: `-${command}` },
    { keybinding, command, when },
  ];
  monaco.editor.addKeybindingRules([
    ...rebind(KeyMod.CtrlCmd | KeyCode.KeyF, 'actions.find', notApp),
    ...rebind(KeyMod.CtrlCmd | KeyCode.BracketRight, 'editor.action.indentLines', `editorTextFocus && ${notApp}`),
    ...rebind(KeyMod.CtrlCmd | KeyCode.BracketLeft, 'editor.action.outdentLines', `editorTextFocus && ${notApp}`),
  ]);
}
