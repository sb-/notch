import { useSyncExternalStore } from 'react';
import * as db from './database';

// In-memory cache mapping resource id -> a ready-to-use data: URL. Resources are
// stored in SQLite as base64 text (see database.ts) and resolved to data URLs on
// demand so cell content only ever holds a stable `notch-resource://<id>` ref.
interface CachedResource {
  dataUrl: string;
  mimeType: string;
  filename: string;
}

const cache = new Map<string, CachedResource>();

// Simple version counter so React components re-render when the cache changes
// (e.g. after a note's resources finish loading, or a new image is inserted).
let version = 0;
const listeners = new Set<() => void>();

function bump(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export const RESOURCE_PROTOCOL = 'notch-resource://';

function toDataUrl(base64: string, mimeType: string): string {
  return `data:${mimeType || 'application/octet-stream'};base64,${base64}`;
}

/** Load all resources for a note into the cache. Idempotent. */
export async function loadResourcesForNote(noteId: string): Promise<void> {
  const resources = await db.getResourcesByNote(noteId);
  let changed = false;
  for (const resource of resources) {
    if (!cache.has(resource.id)) {
      cache.set(resource.id, {
        dataUrl: toDataUrl(resource.data, resource.mimeType ?? ''),
        mimeType: resource.mimeType ?? '',
        filename: resource.filename,
      });
      changed = true;
    }
  }
  if (changed) bump();
}

export function getResourceDataUrl(id: string): string | undefined {
  return cache.get(id)?.dataUrl;
}

/** Resolve a single href/src: `notch-resource://<id>` -> data URL, else unchanged. */
export function resolveResourceUrl(href: string): string {
  if (href.startsWith(RESOURCE_PROTOCOL)) {
    const id = href.slice(RESOURCE_PROTOCOL.length);
    return getResourceDataUrl(id) ?? href;
  }
  return href;
}

/** Persist a new image resource (base64) and warm the cache. Returns its id. */
export async function createResourceFromBase64(
  noteId: string,
  filename: string,
  mimeType: string,
  base64: string
): Promise<string> {
  const resource = await db.createResource(noteId, filename, mimeType, base64);
  cache.set(resource.id, { dataUrl: toDataUrl(base64, mimeType), mimeType, filename });
  bump();
  return resource.id;
}

/** Read a browser File into base64 + mime, then store it as a resource. */
export async function createResourceFromFile(noteId: string, file: File): Promise<string> {
  const { base64, mimeType } = await readFileAsBase64(file);
  return createResourceFromBase64(noteId, file.name || 'image', mimeType, base64);
}

function readFileAsBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      const meta = result.slice(0, comma);
      const base64 = result.slice(comma + 1);
      const mimeMatch = meta.match(/^data:([^;]+)/);
      resolve({ base64, mimeType: mimeMatch?.[1] || file.type || 'application/octet-stream' });
    };
    reader.readAsDataURL(file);
  });
}

/** Convert raw bytes (e.g. from Tauri fs.readFile) to base64. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ---- Rich-text (contentEditable) hydration helpers ----
// Stored form keeps `notch-resource://<id>` in img src; the live DOM needs a real
// data URL. These swap between the two using a DOM template so we never mangle
// attributes with regexes.

export function resolveResourceHtml(html: string): string {
  if (!html.includes(RESOURCE_PROTOCOL)) return html;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') ?? '';
    if (src.startsWith(RESOURCE_PROTOCOL)) {
      const id = src.slice(RESOURCE_PROTOCOL.length);
      img.setAttribute('data-resource-id', id);
      const url = getResourceDataUrl(id);
      if (url) img.setAttribute('src', url);
    }
  });
  return tpl.innerHTML;
}

export function dehydrateResourceHtml(html: string): string {
  if (!html.includes('data-resource-id')) return html;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('img[data-resource-id]').forEach(img => {
    const id = img.getAttribute('data-resource-id');
    if (id) img.setAttribute('src', `${RESOURCE_PROTOCOL}${id}`);
  });
  return tpl.innerHTML;
}

/** Replace resource refs in plain text/markdown with inline data URLs (for export). */
export function inlineResourceRefs(text: string): string {
  return text.replace(/notch-resource:\/\/([\w-]+)/g, (match, id) => getResourceDataUrl(id) ?? match);
}

// ---- React binding ----

export function useResourceVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
