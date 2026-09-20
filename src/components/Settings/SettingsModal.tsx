import { useEffect, useRef } from 'react';
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
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (!dialog) return;

    window.dispatchEvent(new Event('notch-dismiss-menus'));
    dialog.querySelector<HTMLElement>('button')?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      } else if (event.key === 'Tab') {
        const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]'
        )).filter(element => element.getClientRects().length > 0);
        event.preventDefault();
        if (controls.length === 0) {
          dialog.focus();
        } else {
          const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
          const nextIndex = currentIndex < 0
            ? (event.shiftKey ? controls.length - 1 : 0)
            : (currentIndex + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
          controls[nextIndex].focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={() => setOpen(false)}>
      <div
        className="settings-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        <div className="settings-modal-header">
          <span className="settings-modal-title">Settings</span>
          <button className="assistant-icon-btn" title="Close" aria-label="Close settings" onClick={() => setOpen(false)}>✕</button>
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
