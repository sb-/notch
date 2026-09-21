/**
 * End-to-end check of the pi Agent integration against the local Ollama gemma
 * models. Runs headlessly under bun (no Tauri/webview), exercising the same
 * Agent + model configuration the app uses in src/assistant/agent.ts.
 *
 *   bun run scripts/assistant-e2e.ts
 *   E2E_MODEL=gemma4:e4b bun run scripts/assistant-e2e.ts
 *
 * Requires `ollama serve` running with the gemma models pulled.
 */

import '@earendil-works/pi-ai'; // side-effect: register providers
import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import { Type } from 'typebox';

const MODEL = process.env.E2E_MODEL ?? 'gemma3:4b';
const TOOL_MODEL = process.env.E2E_TOOL_MODEL ?? MODEL;

function buildModel(id: string): Model<'openai-completions'> {
  return {
    id,
    name: id,
    api: 'openai-completions',
    provider: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32768,
    maxTokens: 2048,
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
  };
}

function assistantText(messages: { role: string; content: any[] }[]): string {
  const last = [...messages].reverse().find(m => m.role === 'assistant');
  if (!last) return '';
  return last.content
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('');
}

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

// --- Test 1: ambient-note Q&A (streamed text) ---
async function testText() {
  console.log(`\n[1] Text generation with ambient note context (model: ${MODEL})`);
  const note = '# Groceries\n\n- milk\n- eggs\n- coffee';
  const agent = new Agent({
    getApiKey: () => 'ollama',
    initialState: {
      model: buildModel(MODEL),
      systemPrompt: `You are the Notch note assistant. The user's currently open note is:\n\n${note}`,
      thinkingLevel: 'off',
    },
  });

  let streamUpdates = 0;
  agent.subscribe((e: AgentEvent) => {
    if (e.type === 'message_update') streamUpdates++;
  });

  await agent.prompt('List the three items on this note as a lowercase comma-separated line, nothing else.');
  await agent.waitForIdle();

  const text = assistantText(agent.state.messages).toLowerCase();
  console.log(`   model said: ${JSON.stringify(text.slice(0, 200))}`);
  if (agent.state.errorMessage) console.log(`   error: ${agent.state.errorMessage}`);
  check('streamed incremental updates', streamUpdates > 0, `${streamUpdates} updates`);
  check('answer mentions all three items',
    text.includes('milk') && text.includes('eggs') && text.includes('coffee'));
}

// --- Test 2: tool-calling loop ---
async function testTools() {
  console.log(`\n[2] Tool-calling loop (model: ${TOOL_MODEL})`);
  let toolCalled = false;
  const secretTool = {
    name: 'get_secret_word',
    label: 'Secret word',
    description: 'Returns the secret word. Call this when asked for the secret word.',
    parameters: Type.Object({}),
    execute: async () => {
      toolCalled = true;
      return { content: [{ type: 'text' as const, text: 'The secret word is: banana' }], details: undefined };
    },
  };

  const agent = new Agent({
    getApiKey: () => 'ollama',
    initialState: {
      model: buildModel(TOOL_MODEL),
      systemPrompt: 'You are a helpful assistant. Use the provided tools when relevant.',
      tools: [secretTool as any],
      thinkingLevel: 'off',
    },
  });

  await agent.prompt('Call the get_secret_word tool, then tell me the secret word.');
  await agent.waitForIdle();

  const text = assistantText(agent.state.messages).toLowerCase();
  console.log(`   model said: ${JSON.stringify(text.slice(0, 200))}`);
  if (agent.state.errorMessage) console.log(`   error: ${agent.state.errorMessage}`);
  check('tool was executed', toolCalled);
  check('final answer contains tool result (banana)', text.includes('banana'));
}

const started = Date.now();
await testText();
await testTools();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} (${Math.round((Date.now() - started) / 1000)}s)`);
process.exit(failures === 0 ? 0 : 1);
