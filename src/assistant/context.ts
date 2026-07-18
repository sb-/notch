/**
 * Context assembly for the assistant.
 *
 * Strategy (see the integration design): inline the small and specific, search
 * for the large and broad. The currently open note is "ambient" context and is
 * inlined into the system prompt every turn. Anything else (other notes,
 * notebooks, tags) is pulled on demand by the agent via the note tools.
 */

import type { Note } from '../types';
import { exportNoteToMarkdown } from '../services/export';

/** Rough token estimate (~4 chars/token). Good enough for budgeting a meter. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const BASE_INTRO = `You are the assistant built into Notch, a lightweight Quiver-style notebook app. You help the user think about and work with their notes.

Guidelines:
- Be concise and direct. Format replies in Markdown.
- The user's currently open note (if any) is provided below as ambient context. Treat it as "this note" when the user refers to it.`;

const TOOLS_GUIDANCE = `- To use information from OTHER notes, call the tools: search_notes to find notes by keyword, read_note to read a note's full content, and list_notebooks to see the available notebooks. Scope searches to a notebook when the user names one.
- Do not assume notes exist that you have not seen. Search before answering questions about the wider library.
- When you reference a note, cite it by its title.`;

const NO_TOOLS_GUIDANCE = `- You can only see the currently open note shown below; you cannot search the user's other notes. If asked about a note that isn't shown, say so.`;

const OUTPUT_GUIDANCE = `- You answer in chat. You do not edit the user's notes directly; if the user wants content added to a note, provide it in your reply and they will insert it.`;

function baseSystemPrompt(hasTools: boolean): string {
  return [BASE_INTRO, hasTools ? TOOLS_GUIDANCE : NO_TOOLS_GUIDANCE, OUTPUT_GUIDANCE].join('\n');
}

/** Maximum tokens to spend inlining the ambient note before truncating it. */
const AMBIENT_NOTE_TOKEN_BUDGET = 6000;

export function buildSystemPrompt(
  currentNote: Note | null,
  hasTools: boolean,
  referencesBlock = ''
): string {
  const base = baseSystemPrompt(hasTools);
  const refs = referencesBlock.trim()
    ? `\n\nThe user explicitly attached these references with @-mentions:\n\n${referencesBlock}`
    : '';

  if (!currentNote) {
    return `${base}\n\nThe user has no note open right now.${refs}`;
  }

  let noteMarkdown = exportNoteToMarkdown(currentNote);
  let truncated = false;
  if (estimateTokens(noteMarkdown) > AMBIENT_NOTE_TOKEN_BUDGET) {
    noteMarkdown = noteMarkdown.slice(0, AMBIENT_NOTE_TOKEN_BUDGET * 4);
    truncated = true;
  }

  return `${base}

--- CURRENTLY OPEN NOTE (id: ${currentNote.id}) ---
${noteMarkdown}${truncated ? '\n\n[note truncated — use read_note for the full content]' : ''}
--- END OPEN NOTE ---${refs}`;
}
