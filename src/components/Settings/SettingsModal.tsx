import { useStore } from '../../store';
import AssistantSettingsForm from '../../assistant/AssistantSettingsForm';
import './SettingsModal.css';

/**
 * App-level Settings modal. Currently hosts the Assistant section; structured so
 * more sections can be added. Opened via ⌘, the sidebar gear, or the assistant
 * panel gear (all flip the `settingsOpen` store flag).
 */
export default function SettingsModal() {
  const open = useStore(state => state.settingsOpen);
  const setOpen = useStore(state => state.setSettingsOpen);

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={() => setOpen(false)}>
      <div
        className="settings-modal"
        role="dialog"
        aria-label="Settings"
        onClick={e => e.stopPropagation()}
      >
        <div className="settings-modal-header">
          <span className="settings-modal-title">Settings</span>
          <button className="assistant-icon-btn" title="Close" onClick={() => setOpen(false)}>✕</button>
        </div>
        <div className="settings-modal-body">
          <section className="settings-section">
            <div className="settings-section-title">Assistant</div>
            <AssistantSettingsForm onSaved={() => setOpen(false)} />
          </section>
        </div>
      </div>
    </div>
  );
}
