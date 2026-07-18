/**
 * @-mention references for the assistant. Typing "@" in the input lets the user
 * pin notes and notebooks as explicit context. Following the integration design:
 * inline the small and specific (a note's full content), index the large and
 * broad (a notebook becomes a manifest of titles + the search/read tools).
 */

import { useStore } from '../store';
import { getNote } from '../services/database';
import { exportNoteToMarkdown } from '../services/export';
import { estimateTokens } from './context';

export type MentionType = 'note' | 'notebook';

export interface MentionItem {
  type: MentionType;
  id: string;
  label: string;
  sublabel?: string;
}

export interface MentionRef {
  type: MentionType;
  id: string;
  label: string;
}

const MAX_RESULTS = 8;
/** Token cap per inlined referenced note. */
const REF_NOTE_BUDGET = 4000;
/** Max note titles listed in a notebook manifest. */
const REF_MANIFEST_MAX = 60;

function notebookName(notebookId: string): string {
  return useStore.getState().notebooks.find(n => n.id === notebookId)?.name ?? 'Unknown';
}

/** Search notebooks and notes for the autocomplete dropdown. */
export function searchMentions(query: string): MentionItem[] {
  const q = query.trim().toLowerCase();
  const { notes, notebooks } = useStore.getState();
  const items: MentionItem[] = [];

  for (const nb of notebooks) {
    if (!q || nb.name.toLowerCase().includes(q)) {
      items.push({ type: 'notebook', id: nb.id, label: nb.name });
    }
  }
  for (const n of notes) {
    if (n.isTrashed) continue;
    const title = n.title || 'Untitled';
    if (!q || title.toLowerCase().includes(q)) {
      items.push({ type: 'note', id: n.id, label: title, sublabel: notebookName(n.notebookId) });
    }
  }
  return items.slice(0, MAX_RESULTS);
}

/**
 * Resolve pinned references into a context block for the system prompt.
 * Notes are inlined (full content, capped); notebooks become a title manifest.
 */
export async function resolveReferences(refs: MentionRef[]): Promise<string> {
  if (refs.length === 0) return '';
  const state = useStore.getState();
  const blocks: string[] = [];

  for (const ref of refs) {
    if (ref.type === 'note') {
      // Prefer the in-memory note when its body is loaded; otherwise fetch it.
      let note = state.notes.find(n => n.id === ref.id) ?? null;
      if (!note?.bodyLoaded) note = (await getNote(ref.id)) ?? note;
      if (!note) continue;
      let md = exportNoteToMarkdown(note);
      if (estimateTokens(md) > REF_NOTE_BUDGET) {
        md = md.slice(0, REF_NOTE_BUDGET * 4) + '\n\n[truncated — use read_note for the full content]';
      }
      blocks.push(`--- REFERENCED NOTE: ${note.title || 'Untitled'} (id: ${note.id}) ---\n${md}`);
    } else {
      const titles = state.notes
        .filter(n => n.notebookId === ref.id && !n.isTrashed)
        .map(n => `- ${n.title || 'Untitled'} (id: ${n.id})`);
      const capped = titles.slice(0, REF_MANIFEST_MAX);
      const extra = titles.length > capped.length ? `\n…and ${titles.length - capped.length} more` : '';
      blocks.push(
        `--- REFERENCED NOTEBOOK: ${ref.label} (${titles.length} note(s)) ---\n${capped.join('\n')}${extra}\n(Use read_note with an id, or search_notes scoped to this notebook, for details.)`
      );
    }
  }

  return blocks.join('\n\n');
}
