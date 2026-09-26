import { emitTo, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { message } from '@tauri-apps/plugin-dialog';
import { useStore, flushPendingChanges } from '../store';
import { loadResourcesForNote } from './resources';
import { exportNoteToPrintHTML } from './export';

type Snapshot = { title: string; html: string };
const snapshots = new Map<string, Snapshot>();
let revision = 0;
async function snapshot(): Promise<Snapshot | null> {
  const state = useStore.getState();
  const id = state.selectedNoteId;
  if (!id) return null;
  await state.loadNoteBody(id);
  const note = useStore.getState().notes.find(n => n.id === id);
  if (!note) return null;
  await loadResourcesForNote(id);
  return { title: note.title, html: await exportNoteToPrintHTML(note) };
}
export async function openPreview(printing = false): Promise<void> {
  try {
    await flushPendingChanges();
    const content = await snapshot();
    if (!content) return;
    const label = printing ? 'pdf-preview' : 'floating-preview';
    snapshots.set(label, content);
    await invoke('open_preview', { printing });
    await emitTo(label, 'preview-content', content);
  } catch (error) { await message(String(error), { title: 'Preview failed', kind: 'error' }); }
}
export function connectPreviewWindows(): () => void {
  let stopped = false;
  let unlisten: (() => void) | undefined;
  let unlistenClosed: (() => void) | undefined;
  let unlistenNavigate: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  void listen<string>('preview-ready', async event => {
    if (event.payload !== 'floating-preview' && event.payload !== 'pdf-preview') return;
    const content = snapshots.get(event.payload);
    if (content) await emitTo(event.payload, 'preview-content', content);
  }).then(fn => { if (stopped) fn(); else unlisten = fn; });
  void listen<string>('preview-closed', event => {
    snapshots.delete(event.payload);
    if (event.payload === 'floating-preview') { clearTimeout(timer); revision++; }
  }).then(fn => { if (stopped) fn(); else unlistenClosed = fn; });
  void listen<string>('preview-navigate', event => {
    window.dispatchEvent(new CustomEvent('notch-navigate', { detail: { href: event.payload } }));
  }).then(fn => { if (stopped) fn(); else unlistenNavigate = fn; });
  const unsubscribe = useStore.subscribe((state, previous) => {
    if (!snapshots.has('floating-preview')) return;
    const note = state.notes.find(n => n.id === state.selectedNoteId);
    const old = previous.notes.find(n => n.id === previous.selectedNoteId);
    if (note === old) return;
    const current = ++revision;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const content = await snapshot() ?? { title: 'Preview', html: '<p>No note selected</p>' };
        if (stopped || current !== revision) return;
        snapshots.set('floating-preview', content);
        await emitTo('floating-preview', 'preview-content', content);
      } catch (error) { console.warn('Preview update failed:', error); }
    }, 200);
  });
  return () => { stopped = true; clearTimeout(timer); unlisten?.(); unlistenClosed?.(); unlistenNavigate?.(); unsubscribe(); };
}
