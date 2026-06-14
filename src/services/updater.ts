import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { ask, message } from '@tauri-apps/plugin-dialog';

let checking = false;

/**
 * Check GitHub Releases for a newer version and, if the user agrees, download,
 * install, and relaunch into it.
 *
 * @param silent When true (e.g. the automatic check on startup), stay quiet
 *   unless an update is actually available. When false (the "Check for
 *   Updates..." menu item), also report "you're up to date" and any errors.
 */
export async function checkForUpdates(silent = false): Promise<void> {
  if (checking) return;
  checking = true;

  try {
    const update = await check();

    if (!update) {
      if (!silent) {
        await message("You're running the latest version of Notch.", {
          title: 'No Updates Available',
        });
      }
      return;
    }

    await promptAndInstall(update);
  } catch (err) {
    // Offline or a transient endpoint failure shouldn't nag on startup.
    if (silent) {
      console.warn('Update check failed:', err);
    } else {
      await message(`Could not check for updates: ${getErrorMessage(err)}`, {
        title: 'Update Error',
        kind: 'error',
      });
    }
  } finally {
    checking = false;
  }
}

async function promptAndInstall(update: Update): Promise<void> {
  const notes = update.body ? `\n\n${update.body}` : '';
  const shouldInstall = await ask(
    `Notch ${update.version} is available (you have ${update.currentVersion}).${notes}\n\nDownload and install it now?`,
    {
      title: 'Update Available',
      kind: 'info',
      okLabel: 'Install & Restart',
      cancelLabel: 'Later',
    },
  );

  if (!shouldInstall) return;

  try {
    await update.downloadAndInstall((event) => {
      // Hook point for a progress UI; logged for now.
      if (event.event === 'Started') {
        console.info(`Downloading update (${event.data.contentLength ?? '?'} bytes)`);
      } else if (event.event === 'Finished') {
        console.info('Update download finished');
      }
    });
  } catch (err) {
    await message(`Failed to install the update: ${getErrorMessage(err)}`, {
      title: 'Update Error',
      kind: 'error',
    });
    return;
  }

  // The new binary is staged; relaunch to run it.
  await relaunch();
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
