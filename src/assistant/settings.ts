/**
 * Assistant settings — opt-in, local-first configuration for the optional LLM
 * assistant. Stored in localStorage (matching the app's existing config
 * conventions in services/libraries.ts and App.tsx) so it is non-secret and
 * never travels with a note library.
 *
 * The defaults mirror a local Ollama install exposing an OpenAI-compatible API,
 * so the assistant works out of the box against a local model with no cloud key.
 */

const STORAGE_KEY = 'notch.assistant.settings';

export interface AssistantSettings {
  /** Master opt-in. When false the assistant is completely inert. */
  enabled: boolean;
  /** pi provider id (free-form; "ollama" for a local install). */
  provider: string;
  /** OpenAI-compatible base URL. */
  baseUrl: string;
  /** API key. For Ollama any non-empty value works ("ollama"). */
  apiKey: string;
  /** Model id as the provider knows it. */
  model: string;
  /** Context window in tokens, used for budgeting. */
  contextWindow: number;
  /** Max output tokens per response. */
  maxTokens: number;
  /**
   * Whether to attach the note tools (search/read). Requires a tool-capable
   * model — attaching tools to a model that lacks support makes the provider
   * reject every request. Gemma 3 is chat-only; Gemma 4 supports tools.
   */
  supportsTools: boolean;
}

/** Convenience presets for a local Ollama install (mirrors ~/.pi/agent/models.json). */
export interface ModelPreset {
  label: string;
  provider: string;
  baseUrl: string;
  model: string;
  contextWindow: number;
  maxTokens: number;
  supportsTools: boolean;
}

export const LOCAL_MODEL_PRESETS: ModelPreset[] = [
  {
    label: 'Gemma 4 26B (Local · Ollama)',
    provider: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'gemma4:26b-a4b-it-q4_K_M',
    contextWindow: 32768,
    maxTokens: 8192,
    supportsTools: true,
  },
  {
    label: 'Gemma 4 E4B (Local · Ollama)',
    provider: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'gemma4:e4b',
    contextWindow: 65536,
    maxTokens: 8192,
    supportsTools: true,
  },
  {
    label: 'Gemma 3 4B (Local · Ollama, chat-only)',
    provider: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'gemma3:4b',
    contextWindow: 65536,
    maxTokens: 8192,
    supportsTools: false,
  },
];

export const DEFAULT_SETTINGS: AssistantSettings = {
  enabled: false,
  provider: LOCAL_MODEL_PRESETS[0].provider,
  baseUrl: LOCAL_MODEL_PRESETS[0].baseUrl,
  apiKey: 'ollama',
  model: LOCAL_MODEL_PRESETS[0].model,
  contextWindow: LOCAL_MODEL_PRESETS[0].contextWindow,
  maxTokens: LOCAL_MODEL_PRESETS[0].maxTokens,
  supportsTools: LOCAL_MODEL_PRESETS[0].supportsTools,
};

export function getAssistantSettings(): AssistantSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AssistantSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveAssistantSettings(settings: AssistantSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** True when the assistant has the minimum config needed to run. */
export function isAssistantConfigured(settings: AssistantSettings): boolean {
  return (
    settings.enabled &&
    settings.baseUrl.trim().length > 0 &&
    settings.model.trim().length > 0 &&
    settings.apiKey.trim().length > 0
  );
}
