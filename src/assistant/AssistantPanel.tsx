import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Agent } from '@earendil-works/pi-agent-core';
import { useStore, useSelectedNote } from '../store';
import { renderMarkdown } from '../services/markdown';
import {
  getAssistantSettings,
  isAssistantConfigured,
  type AssistantSettings,
} from './settings';
import { createNoteAgent, setAgentContext, extractText } from './agent';
import { searchMentions, resolveReferences, type MentionRef, type MentionItem } from './mentions';
import './AssistantPanel.css';

/**
 * Detect an in-progress "@mention" immediately before the caret: an "@" at the
 * start or after whitespace, followed by non-whitespace up to the caret.
 */
function detectMention(value: string, caret: number): { start: number; query: string } | null {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i];
    if (ch === '@') {
      const before = i === 0 ? ' ' : value[i - 1];
      return /\s/.test(before) ? { start: i, query: value.slice(i + 1, caret) } : null;
    }
    if (/\s/.test(ch)) return null;
  }
  return null;
}

interface DisplayMessage {
  role: 'user' | 'assistant';
  text: string;
  tools: string[];
  streaming: boolean;
}

/** Map the agent's message transcript (+ any in-flight streaming message) to display items. */
function toDisplayMessages(agent: Agent): DisplayMessage[] {
  const out: DisplayMessage[] = [];
  for (const msg of agent.state.messages) {
    if (msg.role === 'user') {
      const text = typeof msg.content === 'string'
        ? msg.content
        : msg.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
      if (text.trim()) out.push({ role: 'user', text, tools: [], streaming: false });
    } else if (msg.role === 'assistant') {
      const text = extractText(msg);
      const tools = (msg.content as any[])
        .filter(c => c.type === 'toolCall')
        .map(c => c.name as string);
      if (text.trim() || tools.length) out.push({ role: 'assistant', text, tools, streaming: false });
    }
  }
  const streaming = agent.state.streamingMessage;
  if (streaming && streaming.role === 'assistant') {
    const text = extractText(streaming);
    const tools = (streaming.content as any[]).filter(c => c.type === 'toolCall').map(c => c.name as string);
    if (text.trim() || tools.length) out.push({ role: 'assistant', text, tools, streaming: true });
  }
  return out;
}

const TOOL_LABELS: Record<string, string> = {
  search_notes: 'Searched notes',
  read_note: 'Read a note',
  list_notebooks: 'Listed notebooks',
};

type Phase = 'idle' | 'waiting' | 'tool' | 'streaming';

/** Derive the inference phase so the UI can show waiting-for-first-token vs streaming. */
function computePhase(agent: Agent): Phase {
  if (!agent.state.isStreaming) return 'idle';
  if (agent.state.pendingToolCalls.size > 0) return 'tool';
  const sm = agent.state.streamingMessage;
  if (sm && sm.role === 'assistant' && extractText(sm).trim().length > 0) return 'streaming';
  return 'waiting';
}

interface UsageStats {
  /** Prompt tokens of the most recent turn (input + cached) ≈ current context occupancy. */
  contextTokens: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCost: number;
}

/** Aggregate token usage across the conversation from pi's per-message Usage. */
function computeUsage(agent: Agent): UsageStats | null {
  let any = false;
  let contextTokens = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCost = 0;
  for (const m of agent.state.messages) {
    if (m.role !== 'assistant') continue;
    const u = (m as { usage?: { input?: number; output?: number; cacheRead?: number; cost?: { total?: number } } }).usage;
    if (!u) continue;
    any = true;
    totalInput += u.input ?? 0;
    totalOutput += u.output ?? 0;
    totalCacheRead += u.cacheRead ?? 0;
    totalCost += u.cost?.total ?? 0;
    contextTokens = (u.input ?? 0) + (u.cacheRead ?? 0);
  }
  return any ? { contextTokens, totalInput, totalOutput, totalCacheRead, totalCost } : null;
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

export default function AssistantPanel() {
  const setAssistantVisible = useStore(state => state.setAssistantVisible);
  const addCell = useStore(state => state.addCell);
  const updateCell = useStore(state => state.updateCell);
  const currentNote = useSelectedNote();

  const [settings, setSettings] = useState<AssistantSettings>(() => getAssistantSettings());
  const settingsVersion = useStore(state => state.assistantSettingsVersion);
  const openSettings = useStore(state => state.setSettingsOpen);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  // @-mention state: pinned references + the in-progress autocomplete.
  const [refs, setRefs] = useState<MentionRef[]>([]);
  const [mention, setMention] = useState<{ start: number; caret: number; query: string } | null>(null);
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);

  const agentRef = useRef<Agent | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // Whether the view is pinned to the bottom. Only auto-scroll while pinned, so
  // the user can scroll up to read earlier output mid-stream without being yanked.
  const pinnedToBottomRef = useRef(true);
  const configured = isAssistantConfigured(settings);
  const mentionOpen = mention !== null && mentionItems.length > 0;

  // Re-read settings whenever they're saved (in the Settings modal).
  useEffect(() => {
    setSettings(getAssistantSettings());
  }, [settingsVersion]);

  // Build (or rebuild) the agent whenever the effective settings change.
  useEffect(() => {
    if (!configured) {
      agentRef.current = null;
      return;
    }
    const agent = createNoteAgent(settings, currentNote);
    agentRef.current = agent;
    const unsubscribe = agent.subscribe(event => {
      // `isStreaming` stays true until agent_end listeners settle, and no further
      // event follows — so treat agent_end as definitively done, else the Stop
      // button sticks after the run finishes.
      const done = event.type === 'agent_end';
      setMessages(toDisplayMessages(agent));
      setBusy(done ? false : agent.state.isStreaming);
      setPhase(done ? 'idle' : computePhase(agent));
      setUsage(computeUsage(agent));
      setError(agent.state.errorMessage ?? null);
    });
    setMessages(toDisplayMessages(agent));
    return () => {
      unsubscribe();
      agent.abort();
    };
    // Rebuild only on config change, not on every note switch (the open note is
    // refreshed per-send via setAmbientNote).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.provider, settings.baseUrl, settings.model, settings.apiKey, settings.contextWindow, settings.supportsTools, configured]);

  // Keep scrolled to the latest message, but only when the user is already at the
  // bottom (so scrolling up mid-stream isn't interrupted).
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleMessagesScroll = () => {
    const el = scrollRef.current;
    if (el) pinnedToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  // Auto-grow the input from a single line up to a max as the user types.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

  const send = useCallback(async () => {
    const agent = agentRef.current;
    const text = input.trim();
    if (!agent || !text || busy) return;
    setInput('');
    setMention(null);
    setError(null);
    // Resolve @-mentioned references (notes inlined, notebooks as manifests) and
    // attach them — alongside the open note — to the system prompt for this turn.
    const referencesBlock = await resolveReferences(refs);
    setAgentContext(agent, currentNote, settings.supportsTools, referencesBlock);
    try {
      await agent.prompt(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [input, busy, currentNote, refs, settings.supportsTools]);

  const insertIntoNote = useCallback(async (text: string) => {
    if (!currentNote) return;
    // Insert into the cell the user is focused on (appending, keeping its type),
    // mirroring the editor's image-insert behavior. Only create a new markdown
    // cell when the note has no cells to target.
    const focusedId = useStore.getState().focusedCellId;
    const target =
      currentNote.cells.find(c => c.id === focusedId) ??
      currentNote.cells[currentNote.cells.length - 1] ??
      null;
    if (target) {
      const sep = target.data.trim() ? '\n\n' : '';
      await updateCell(currentNote.id, target.id, { data: `${target.data}${sep}${text}` });
    } else {
      const cell = await addCell(currentNote.id, 'markdown');
      await updateCell(currentNote.id, cell.id, { data: text });
    }
  }, [currentNote, addCell, updateCell]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    const caret = e.target.selectionStart ?? value.length;
    const det = detectMention(value, caret);
    if (det) {
      setMention({ start: det.start, caret, query: det.query });
      setMentionItems(searchMentions(det.query));
      setMentionIndex(0);
    } else {
      setMention(null);
    }
  };

  const selectMention = (item: MentionItem) => {
    setRefs(prev =>
      prev.some(r => r.type === item.type && r.id === item.id)
        ? prev
        : [...prev, { type: item.type, id: item.id, label: item.label }]
    );
    if (mention) {
      // Strip the "@query" fragment from the input.
      const next = input.slice(0, mention.start) + input.slice(mention.caret);
      setInput(next);
      const pos = mention.start;
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) { el.focus(); el.setSelectionRange(pos, pos); }
      });
    }
    setMention(null);
  };

  const removeRef = (index: number) => setRefs(prev => prev.filter((_, i) => i !== index));

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => (i + 1) % mentionItems.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => (i - 1 + mentionItems.length) % mentionItems.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMention(mentionItems[mentionIndex]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMention(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="assistant-panel">
      <div className="assistant-header">
        <span className="assistant-title">Assistant</span>
        <div className="assistant-header-actions">
          <button className="assistant-icon-btn" title="Settings" onClick={() => openSettings(true)}>⚙</button>
          <button className="assistant-icon-btn" title="Close" onClick={() => setAssistantVisible(false)}>✕</button>
        </div>
      </div>

      {!configured && (
        <div className="assistant-empty">
          <p>The assistant is off. Open settings to enable it and pick a model.</p>
          <button className="assistant-send-btn" onClick={() => openSettings(true)}>Open settings</button>
        </div>
      )}

      {configured && (
        <>
          <div className="assistant-context-bar">
            <span className="assistant-context-label">Context</span>
            <span className="assistant-context-note" title={currentNote?.title || undefined}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              {currentNote ? (currentNote.title || 'Untitled') : 'No note open'}
            </span>
          </div>

          <div className="assistant-messages" ref={scrollRef} onScroll={handleMessagesScroll}>
            {messages.length === 0 && (
              <div className="assistant-hint">Ask about the open note, or to search your other notes.</div>
            )}
            {messages.map((m, i) => (
              <MessageBubble
                key={i}
                message={m}
                canInsert={!!currentNote && m.role === 'assistant' && !m.streaming && !!m.text.trim()}
                onInsert={() => insertIntoNote(m.text)}
              />
            ))}
            {busy && phase !== 'streaming' && (
              <div className="assistant-status">
                <span className="assistant-typing"><i /><i /><i /></span>
                <span>{phase === 'tool' ? 'Searching your notes…' : 'Thinking…'}</span>
              </div>
            )}
            {error && <div className="assistant-error">Error: {error}</div>}
          </div>

          {refs.length > 0 && (
            <div className="assistant-pills">
              {refs.map((r, i) => (
                <span key={`${r.type}-${r.id}`} className="assistant-pill" title={`${r.type}: ${r.label}`}>
                  <span className="assistant-pill-icon">{r.type === 'notebook' ? '📓' : '📄'}</span>
                  <span className="assistant-pill-label">{r.label}</span>
                  <button className="assistant-pill-remove" onClick={() => removeRef(i)} title="Remove">✕</button>
                </span>
              ))}
            </div>
          )}

          {usage && (
            <div
              className="assistant-usage"
              title={`Context: ${usage.contextTokens} / ${settings.contextWindow} tokens · session ↑${usage.totalInput} in ↓${usage.totalOutput} out${usage.totalCacheRead > 0 ? ` · ${usage.totalCacheRead} cached` : ''}`}
            >
              <div className="assistant-usage-meter">
                <div
                  className="assistant-usage-fill"
                  style={{ width: `${Math.min(100, Math.round((usage.contextTokens / Math.max(1, settings.contextWindow)) * 100))}%` }}
                />
              </div>
              <span className="assistant-usage-ctx">{fmtTokens(usage.contextTokens)}/{fmtTokens(settings.contextWindow)}</span>
              <span className="assistant-usage-sep">↑{fmtTokens(usage.totalInput)} ↓{fmtTokens(usage.totalOutput)}</span>
              {usage.totalCacheRead > 0 && (
                <span className="assistant-usage-sep">cache {Math.round((usage.totalCacheRead / (usage.totalCacheRead + usage.totalInput)) * 100)}%</span>
              )}
              {usage.totalCost > 0 && <span className="assistant-usage-sep">${usage.totalCost.toFixed(3)}</span>}
            </div>
          )}

          <div className="assistant-input-row">
            {mentionOpen && (
              <div className="assistant-mention-dropdown">
                {mentionItems.map((item, i) => (
                  <button
                    key={`${item.type}-${item.id}`}
                    className={`assistant-mention-item ${i === mentionIndex ? 'active' : ''}`}
                    onMouseDown={e => { e.preventDefault(); selectMention(item); }}
                    onMouseEnter={() => setMentionIndex(i)}
                  >
                    <span className="assistant-mention-icon">{item.type === 'notebook' ? '📓' : '📄'}</span>
                    <span className="assistant-mention-label">{item.label}</span>
                    {item.sublabel && <span className="assistant-mention-sub">{item.sublabel}</span>}
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={inputRef}
              className="assistant-input"
              placeholder="Ask the assistant…  (@ to reference)"
              value={input}
              onChange={handleInputChange}
              onKeyDown={onKeyDown}
              rows={1}
            />
            {busy ? (
              <button className="assistant-send-btn" onClick={() => agentRef.current?.abort()}>Stop</button>
            ) : (
              <button className="assistant-send-btn" onClick={() => void send()} disabled={!input.trim()}>Send</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MessageBubble({ message, canInsert, onInsert }: {
  message: DisplayMessage;
  canInsert: boolean;
  onInsert: () => void;
}) {
  const html = useMemo(
    () => (message.role === 'assistant' ? renderMarkdown(message.text) : ''),
    [message.role, message.text]
  );
  return (
    <div className={`assistant-msg assistant-msg-${message.role}`}>
      {message.tools.length > 0 && (
        <div className="assistant-tools">
          {message.tools.map((t, i) => (
            <span key={i} className="assistant-tool-chip">{TOOL_LABELS[t] ?? t}{message.streaming ? '…' : ''}</span>
          ))}
        </div>
      )}
      {message.role === 'assistant'
        ? <div className="assistant-md" dangerouslySetInnerHTML={{ __html: html }} />
        : <div className="assistant-usertext">{message.text}</div>}
      {canInsert && (
        <button className="assistant-insert-btn" onClick={onInsert} title="Append to the focused cell of the open note">
          Insert into note
        </button>
      )}
    </div>
  );
}
