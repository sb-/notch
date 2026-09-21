/**
 * The only module that touches the pi packages. Everything pi-specific is
 * confined here so an upgrade (pi is pre-1.0) is a one-file change.
 *
 * We use the low-level Agent class (not AgentHarness): it needs only a stream
 * function, an api key, a model, and tools — no Node, no filesystem, no
 * sessions. The OpenAI-compatible provider talks to a local Ollama endpoint
 * directly from the webview (Ollama allows the tauri:// origin via CORS), so no
 * Rust/transport changes are required.
 */

import '@earendil-works/pi-ai'; // side-effect: registers the (lazy) api providers
import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import type { Note } from '../types';
import type { AssistantSettings } from './settings';
import { noteTools } from './tools';
import { buildSystemPrompt } from './context';

export function buildModel(settings: AssistantSettings): Model<'openai-completions'> {
  return {
    id: settings.model,
    name: settings.model,
    api: 'openai-completions',
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: settings.contextWindow,
    maxTokens: settings.maxTokens,
    // Local OpenAI-compatible servers (Ollama) use the `system` role and don't
    // support reasoning_effort. Mirrors ~/.pi/agent/models.json.
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
  };
}

export function createNoteAgent(settings: AssistantSettings, currentNote: Note | null): Agent {
  const model = buildModel(settings);
  return new Agent({
    getApiKey: () => settings.apiKey,
    initialState: {
      model,
      systemPrompt: buildSystemPrompt(currentNote, settings.supportsTools),
      // Only attach tools to tool-capable models; otherwise the provider rejects
      // every request (e.g. Ollama: "<model> does not support tools").
      tools: settings.supportsTools ? noteTools : [],
      thinkingLevel: 'off',
    },
  });
}

/**
 * Refresh the ambient (currently-open) note in the agent's system prompt. The
 * underlying state object is mutable; the public type marks the field readonly,
 * hence the cast.
 */
export function setAgentContext(
  agent: Agent,
  note: Note | null,
  hasTools: boolean,
  referencesBlock = ''
): void {
  (agent.state as { systemPrompt: string }).systemPrompt = buildSystemPrompt(note, hasTools, referencesBlock);
}

/** Concatenate the text blocks of an assistant message for display. */
export function extractText(message: AgentMessage | undefined): string {
  if (!message || message.role !== 'assistant') return '';
  return message.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map(c => c.text)
    .join('');
}
