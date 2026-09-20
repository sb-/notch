import { describe, expect, test } from 'bun:test';
import { withMenuDismissal } from './nativeActions';

describe('native menu actions', () => {
  test('dismisses popovers before opening a native dialog and preserves arguments and results', async () => {
    const events: string[] = [];
    const actions = withMenuDismissal({
      exportNote: async (format: string) => {
        events.push(`export:${format}`);
        return 'saved';
      },
      setView: (view: string) => events.push(`view:${view}`),
    }, () => events.push('dismiss'));

    expect(await actions.exportNote('markdown')).toBe('saved');
    actions.setView('preview');
    expect(events).toEqual(['dismiss', 'export:markdown', 'dismiss', 'view:preview']);
  });

  test('keeps failures observable after dismissing the menu', async () => {
    let dismissed = false;
    const actions = withMenuDismissal({
      open: async () => { throw new Error('Could not open library'); },
    }, () => { dismissed = true; });

    await expect(actions.open()).rejects.toThrow('Could not open library');
    expect(dismissed).toBe(true);
  });
});
