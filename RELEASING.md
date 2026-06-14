# Releasing Notch

Notch ships as a universal macOS `.dmg` built by GitHub Actions
(`.github/workflows/release.yml`) and supports in-app auto-updates via Tauri's
updater plugin.

## How it fits together

1. You push a version tag (`v*`). The workflow builds a universal `.dmg`,
   signs the updater bundle, and creates a **draft** GitHub Release containing:
   - `Notch_<version>_universal.dmg` — what people download to install
   - `Notch.app.tar.gz` + `.sig` — the payload the auto-updater installs
   - `latest.json` — the manifest the app polls
2. You review and **publish** the draft release.
3. Installed copies of Notch check
   `https://github.com/sb-/notch/releases/latest/download/latest.json` on launch
   (and via **Help → Check for Updates…**), verify the download's signature
   against the public key baked into `tauri.conf.json`, then download, install,
   and relaunch.

## One-time setup: GitHub secrets

### Required — updater signing

The signing keypair lives locally at `~/.tauri/notch.key` (private) and
`~/.tauri/notch.key.pub` (public, already committed in `tauri.conf.json`). Its
password is stored at `~/.tauri/notch.pass`. Both repo secrets are already set;
to (re)create them:

```sh
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/notch.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD < ~/.tauri/notch.pass
```

> ⚠️ **Back up `~/.tauri/notch.key` and `~/.tauri/notch.pass`** (e.g. to a
> password manager). If you lose either you can no longer sign updates that
> existing installs will accept — you'd have to ship a new public key, which
> breaks the update chain for everyone already on an old version.

### Optional — Apple Developer ID signing & notarization

Without these, the workflow still produces a working `.dmg`, but macOS shows an
"unidentified developer" warning on first launch (users right-click → **Open**).
Add all six to get a clean, notarized, double-clickable install — **no workflow
changes needed**, the workflow signs automatically once they exist:

| Secret | What it is |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64 of your exported *Developer ID Application* `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | The password you set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_PASSWORD` | An [app-specific password](https://appleid.apple.com) |
| `APPLE_TEAM_ID` | Your 10-character Apple Team ID |

Export the certificate from **Keychain Access** (select the *Developer ID
Application* cert *and* its private key → Export as `.p12`), then:

```sh
base64 -i certificate.p12 | pbcopy   # paste into the APPLE_CERTIFICATE secret
```

## Cutting a release

1. Bump the version in **all three** places (keep them in sync):
   - `package.json` → `version`
   - `src-tauri/tauri.conf.json` → `version`
   - `src-tauri/Cargo.toml` → `version`
2. Commit the bump.
3. Tag and push:
   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```
4. Watch the run in the **Actions** tab. When it finishes, go to **Releases**,
   review the draft, and click **Publish**.
5. Done — installed apps will offer the update on their next launch.

You can also trigger the workflow manually from the Actions tab (provide an
existing tag).

## Notes

- The updater only offers an update when the release version is **higher** than
  the installed version, so always bump before tagging.
- Drafts are intentional: the updater endpoint points at the *latest published*
  release, so a draft won't be offered to users until you publish it.
- To add Windows/Linux builds later, expand the workflow into a matrix over
  `windows-latest` / `ubuntu-22.04`; `tauri-action` merges all platforms'
  artifacts into the same release and `latest.json`.
