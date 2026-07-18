import { useEffect, useState } from 'react';
import { useStore } from '../store';
import {
  getAssistantSettings,
  saveAssistantSettings,
  fetchAvailableModels,
  LOCAL_MODEL_PRESETS,
  type AssistantSettings,
} from './settings';
import './AssistantPanel.css';

type ModelsState = 'idle' | 'loading' | 'error';

/**
 * The assistant/pi configuration form. Lives in the app Settings modal (and is
 * deep-linked from the assistant panel gear). It is pi-free — only settings +
 * a models fetch — so it doesn't pull the agent into the startup bundle.
 */
export default function AssistantSettingsForm({ onSaved }: { onSaved?: () => void }) {
  const [draft, setDraft] = useState<AssistantSettings>(() => getAssistantSettings());
  const [models, setModels] = useState<string[]>([]);
  const [modelsState, setModelsState] = useState<ModelsState>('idle');

  const update = (patch: Partial<AssistantSettings>) => setDraft(d => ({ ...d, ...patch }));

  const detect = async (baseUrl: string, apiKey: string) => {
    if (!baseUrl.trim()) return;
    setModelsState('loading');
    try {
      setModels(await fetchAvailableModels(baseUrl, apiKey));
      setModelsState('idle');
    } catch {
      setModels([]);
      setModelsState('error');
    }
  };

  // Detect installed models when the form opens.
  useEffect(() => {
    void detect(draft.baseUrl, draft.apiKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickModel = (id: string) => {
    if (!id) return;
    // Heuristic: Gemma 3 is chat-only in Ollama; assume others are tool-capable.
    update({ model: id, supportsTools: !/gemma\s*-?3/i.test(id) });
  };

  const useLocalDefault = () => {
    const p = LOCAL_MODEL_PRESETS[0];
    update({
      provider: p.provider,
      baseUrl: p.baseUrl,
      model: p.model,
      contextWindow: p.contextWindow,
      maxTokens: p.maxTokens,
      supportsTools: p.supportsTools,
    });
    void detect(p.baseUrl, 'ollama');
  };

  const save = () => {
    saveAssistantSettings(draft);
    useStore.getState().bumpAssistantSettings();
    onSaved?.();
  };

  return (
    <div className="assistant-settings">
      <label className="assistant-field assistant-field-row">
        <input type="checkbox" checked={draft.enabled} onChange={e => update({ enabled: e.target.checked })} />
        <span>Enable assistant</span>
      </label>

      <label className="assistant-field">
        <span>Base URL</span>
        <input
          value={draft.baseUrl}
          onChange={e => update({ baseUrl: e.target.value })}
          onBlur={() => void detect(draft.baseUrl, draft.apiKey)}
          placeholder="http://localhost:11434/v1"
        />
      </label>

      <label className="assistant-field">
        <span>API key</span>
        <input
          type="password"
          value={draft.apiKey}
          onChange={e => update({ apiKey: e.target.value })}
          placeholder="ollama (for local)"
        />
      </label>

      <div className="assistant-field">
        <span>
          Model
          {modelsState === 'loading' && ' · detecting…'}
          {modelsState === 'error' && ' · couldn’t reach endpoint'}
        </span>
        <div className="assistant-field-row">
          <select
            style={{ flex: 1 }}
            value={models.includes(draft.model) ? draft.model : ''}
            onChange={e => pickModel(e.target.value)}
          >
            <option value="">{models.length ? 'Select a detected model…' : 'No models detected'}</option>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <button
            type="button"
            className="assistant-icon-btn"
            title="Refresh models"
            onClick={() => void detect(draft.baseUrl, draft.apiKey)}
          >
            ↻
          </button>
        </div>
      </div>

      <label className="assistant-field">
        <span>Model id</span>
        <input value={draft.model} onChange={e => update({ model: e.target.value })} placeholder="e.g. gemma4:e4b" />
      </label>

      <label className="assistant-field">
        <span>Context window (tokens)</span>
        <input
          type="number"
          value={draft.contextWindow}
          onChange={e => update({ contextWindow: Number(e.target.value) || 0 })}
        />
      </label>

      <label className="assistant-field assistant-field-row">
        <input type="checkbox" checked={draft.supportsTools} onChange={e => update({ supportsTools: e.target.checked })} />
        <span>Let it search my notes (needs a tool-capable model)</span>
      </label>

      <p className="assistant-settings-note">
        Models are detected from the endpoint’s <code>/models</code> list. Tool use (searching your notes) needs a
        tool-capable model — Gemma 4 supports it; Gemma 3 is chat-only.
      </p>

      <div className="assistant-settings-actions">
        <button type="button" className="assistant-insert-btn" onClick={useLocalDefault}>Use local default</button>
        <button type="button" className="assistant-send-btn" onClick={save}>Save</button>
      </div>
    </div>
  );
}
