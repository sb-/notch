/**
 * Note-aware tools handed to the pi agent. These replace the coding-agent's
 * filesystem/bash tools entirely: the agent's only capabilities are reading and
 * searching the user's notes. All tools are read-only — writing to notes is a
 * separate, explicit, user-confirmed action in the UI, keeping the assistant
 * additive (see the integration design).
 */

import { Type, type Static } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { searchNotes } from '../services/search';
import { getNote } from '../services/database';
import { exportNoteToMarkdown } from '../services/export';
import { useStore } from '../store';

function text(s: string): { content: { type: 'text'; text: string }[]; details: undefined } {
  return { content: [{ type: 'text', text: s }], details: undefined };
}

function notebookName(notebookId: string): string {
  const nb = useStore.getState().notebooks.find(n => n.id === notebookId);
  return nb?.name ?? 'Unknown notebook';
}

const SearchParams = Type.Object({
  query: Type.String({ description: 'Keywords to search for across note titles and content.' }),
  notebook: Type.Optional(
    Type.String({ description: 'Optional notebook name to scope the search to.' })
  ),
  limit: Type.Optional(Type.Number({ description: 'Max results (default 10).' })),
});

const searchNotesTool: AgentTool<typeof SearchParams> = {
  name: 'search_notes',
  label: 'Search notes',
  description:
    'Full-text search across the user\'s notes. Returns matching note titles and ids, ranked by relevance. Use read_note to read a result.',
  parameters: SearchParams,
  execute: async (_id, { query, notebook, limit }: Static<typeof SearchParams>) => {
    let notebookId: string | undefined;
    if (notebook) {
      const match = useStore
        .getState()
        .notebooks.find(n => n.name.toLowerCase() === notebook.toLowerCase());
      if (!match) {
        return text(`No notebook named "${notebook}". Use list_notebooks to see available notebooks.`);
      }
      notebookId = match.id;
    }

    const results = await searchNotes(query, { notebookId, limit: limit ?? 10 });
    if (results.length === 0) {
      return text(`No notes matched "${query}"${notebook ? ` in ${notebook}` : ''}.`);
    }

    const lines = results.map(
      n => `- "${n.title}" (id: ${n.id}, notebook: ${notebookName(n.notebookId)})`
    );
    return text(`Found ${results.length} note(s):\n${lines.join('\n')}`);
  },
};

const ReadParams = Type.Object({
  id: Type.String({ description: 'The note id, as returned by search_notes.' }),
});

const readNoteTool: AgentTool<typeof ReadParams> = {
  name: 'read_note',
  label: 'Read note',
  description: 'Read the full Markdown content of a note by its id.',
  parameters: ReadParams,
  execute: async (_id, { id }: Static<typeof ReadParams>) => {
    const note = await getNote(id);
    if (!note) return text(`No note found with id ${id}.`);
    return text(
      `Note "${note.title}" (notebook: ${notebookName(note.notebookId)}):\n\n${exportNoteToMarkdown(note)}`
    );
  },
};

const ListNotebooksParams = Type.Object({});

const listNotebooksTool: AgentTool<typeof ListNotebooksParams> = {
  name: 'list_notebooks',
  label: 'List notebooks',
  description: 'List the user\'s notebooks by name, so searches can be scoped to one.',
  parameters: ListNotebooksParams,
  execute: async () => {
    const notebooks = useStore.getState().notebooks;
    if (notebooks.length === 0) return text('There are no notebooks.');
    return text(`Notebooks:\n${notebooks.map(n => `- ${n.name}`).join('\n')}`);
  },
};

export const noteTools: AgentTool[] = [
  searchNotesTool as AgentTool,
  readNoteTool as AgentTool,
  listNotebooksTool as AgentTool,
];
