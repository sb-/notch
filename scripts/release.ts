#!/usr/bin/env bun
/**
 * Release helper for Notch.
 *
 *   bun run release            # preflight checks + minor bump (default)
 *   bun run release patch      # bump patch instead
 *   bun run release major      # bump major
 *   bun run release --check    # run preflight checks only, don't bump
 *   bun run release minor --tag        # bump, commit, and create the git tag
 *   bun run release minor --tag --push # ...and push branch + tag (triggers CI)
 *   bun run release --dry-run  # show what would change without writing
 *
 * Keeps package.json, src-tauri/tauri.conf.json, and src-tauri/Cargo.toml in
 * sync, and verifies the macOS release + auto-updater config end-to-end before
 * letting you tag a release.
 */
import { $ } from 'bun';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const ROOT = join(import.meta.dir, '..');
const PKG = join(ROOT, 'package.json');
const TAURI_CONF = join(ROOT, 'src-tauri/tauri.conf.json');
const CARGO = join(ROOT, 'src-tauri/Cargo.toml');
const CAPS = join(ROOT, 'src-tauri/capabilities/default.json');
const MAIN_RS = join(ROOT, 'src-tauri/src/main.rs');
const WORKFLOW = join(ROOT, '.github/workflows/release.yml');
const SIGNING_KEY = join(homedir(), '.tauri/notch.key');

type BumpType = 'major' | 'minor' | 'patch';
type Status = 'ok' | 'warn' | 'fail';

const ICON: Record<Status, string> = { ok: '✓', warn: '⚠', fail: '✗' };
const COLOR: Record<Status, string> = { ok: '\x1b[32m', warn: '\x1b[33m', fail: '\x1b[31m' };
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

interface Check {
  label: string;
  status: Status;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(readFileSync(import.meta.path, 'utf-8').split('*/')[0].replace(/^#![^\n]*\n\/\*\*?/, '').trim());
  process.exit(0);
}

let bump: BumpType = 'minor';
for (const arg of argv) {
  if (arg === 'major' || arg === '--major') bump = 'major';
  else if (arg === 'minor' || arg === '--minor') bump = 'minor';
  else if (arg === 'patch' || arg === '--patch') bump = 'patch';
}
const checkOnly = argv.includes('--check') || argv.includes('-c');
const dryRun = argv.includes('--dry-run') || argv.includes('-n');
const doPush = argv.includes('--push');
const doTag = argv.includes('--tag') || doPush;

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

function readPkgVersion(): string {
  return JSON.parse(readFileSync(PKG, 'utf-8')).version;
}
function readTauriVersion(): string {
  return JSON.parse(readFileSync(TAURI_CONF, 'utf-8')).version;
}
function readCargoVersion(): string {
  const m = readFileSync(CARGO, 'utf-8').match(/^version = "([^"]+)"/m);
  return m ? m[1] : '';
}

function bumpVersion(version: string, type: BumpType): string {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`Version "${version}" is not semver X.Y.Z`);
  let [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (type === 'major') (major += 1), (minor = 0), (patch = 0);
  else if (type === 'minor') (minor += 1), (patch = 0);
  else patch += 1;
  return `${major}.${minor}.${patch}`;
}

function writeVersion(next: string): void {
  // Targeted replaces preserve each file's formatting (vs. re-stringifying).
  const pkg = readFileSync(PKG, 'utf-8').replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`);
  const tauri = readFileSync(TAURI_CONF, 'utf-8').replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`);
  const cargo = readFileSync(CARGO, 'utf-8').replace(/^version = "[^"]+"/m, `version = "${next}"`);
  writeFileSync(PKG, pkg);
  writeFileSync(TAURI_CONF, tauri);
  writeFileSync(CARGO, cargo);
}

// ---------------------------------------------------------------------------
// Preflight checks
// ---------------------------------------------------------------------------

async function runChecks(): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (label: string, status: Status, detail?: string) => checks.push({ label, status, detail });

  // Versions in sync + valid semver
  const pkgV = readPkgVersion();
  const tauriV = readTauriVersion();
  const cargoV = readCargoVersion();
  if (pkgV === tauriV && tauriV === cargoV) {
    if (/^\d+\.\d+\.\d+$/.test(pkgV)) add('Versions in sync', 'ok', `all at ${pkgV}`);
    else add('Version is valid semver', 'fail', `"${pkgV}" is not X.Y.Z`);
  } else {
    add('Versions in sync', 'fail', `package.json=${pkgV}, tauri.conf=${tauriV}, Cargo.toml=${cargoV}`);
  }

  // Updater config in tauri.conf.json
  const conf = JSON.parse(readFileSync(TAURI_CONF, 'utf-8'));
  const updater = conf.plugins?.updater;
  const endpoints: string[] = updater?.endpoints ?? [];
  if (endpoints.length && endpoints.some((e) => e.includes('latest.json'))) {
    add('Updater endpoint set', 'ok', endpoints[0]);
  } else {
    add('Updater endpoint set', 'fail', 'plugins.updater.endpoints missing a latest.json URL');
  }

  const pubkey: string = updater?.pubkey ?? '';
  let pubkeyOk = false;
  try {
    pubkeyOk = pubkey.length > 40 && Buffer.from(pubkey, 'base64').toString('utf-8').includes('minisign public key');
  } catch {
    pubkeyOk = false;
  }
  add('Updater public key set', pubkeyOk ? 'ok' : 'fail',
    pubkeyOk ? undefined : 'plugins.updater.pubkey missing or not a minisign key');

  add('createUpdaterArtifacts enabled', conf.bundle?.createUpdaterArtifacts === true ? 'ok' : 'fail',
    conf.bundle?.createUpdaterArtifacts === true ? undefined : 'bundle.createUpdaterArtifacts must be true');

  const targets = conf.bundle?.targets;
  const targetsOk = targets === 'all' || (Array.isArray(targets) && targets.includes('dmg')) || targets === 'dmg';
  add('Bundle produces a .dmg', targetsOk ? 'ok' : 'warn',
    targetsOk ? `targets: ${JSON.stringify(targets)}` : `targets ${JSON.stringify(targets)} may not include dmg`);

  // Capabilities
  const caps = JSON.parse(readFileSync(CAPS, 'utf-8'));
  const perms: string[] = caps.permissions ?? [];
  const hasUpdater = perms.includes('updater:default');
  const hasProcess = perms.includes('process:default');
  add('Updater + process permissions', hasUpdater && hasProcess ? 'ok' : 'fail',
    hasUpdater && hasProcess ? undefined : `missing ${[!hasUpdater && 'updater:default', !hasProcess && 'process:default'].filter(Boolean).join(', ')}`);

  // Cargo dependencies
  const cargo = readFileSync(CARGO, 'utf-8');
  const cargoOk = cargo.includes('tauri-plugin-updater') && cargo.includes('tauri-plugin-process');
  add('Rust updater plugins in Cargo.toml', cargoOk ? 'ok' : 'fail',
    cargoOk ? undefined : 'add tauri-plugin-updater and tauri-plugin-process');

  // main.rs registration
  const mainRs = readFileSync(MAIN_RS, 'utf-8');
  const regOk = mainRs.includes('tauri_plugin_updater') && mainRs.includes('tauri_plugin_process');
  add('Plugins registered in main.rs', regOk ? 'ok' : 'warn',
    regOk ? undefined : 'updater/process plugins not registered in the builder');

  // Workflow
  add('Release workflow present', existsSync(WORKFLOW) ? 'ok' : 'fail',
    existsSync(WORKFLOW) ? undefined : 'missing .github/workflows/release.yml');

  // Local signing key (CI uses the secret; local builds need this file)
  add('Local updater signing key', existsSync(SIGNING_KEY) ? 'ok' : 'warn',
    existsSync(SIGNING_KEY) ? SIGNING_KEY : `${SIGNING_KEY} not found (CI uses the GitHub secret; needed only for local signed builds)`);

  // GitHub secrets via gh
  try {
    const out = await $`gh secret list`.quiet().nothrow();
    if (out.exitCode === 0) {
      const names = out.stdout.toString();
      const hasKey = names.includes('TAURI_SIGNING_PRIVATE_KEY');
      const hasPwd = names.includes('TAURI_SIGNING_PRIVATE_KEY_PASSWORD');
      add('GitHub updater secrets', hasKey && hasPwd ? 'ok' : 'warn',
        hasKey && hasPwd ? undefined : `missing ${[!hasKey && 'TAURI_SIGNING_PRIVATE_KEY', !hasPwd && 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD'].filter(Boolean).join(', ')} — see RELEASING.md`);
    } else {
      add('GitHub updater secrets', 'warn', 'could not list secrets (gh not authed?) — verify manually, see RELEASING.md');
    }
  } catch {
    add('GitHub updater secrets', 'warn', 'gh CLI not available — verify TAURI_SIGNING_* secrets manually');
  }

  // Working tree
  try {
    const status = await $`git status --porcelain`.quiet().nothrow();
    const dirty = status.stdout.toString().trim().length > 0;
    if (doTag) {
      add('Clean working tree', dirty ? 'warn' : 'ok',
        dirty ? 'tree is dirty; only the version files will be committed for the tag' : undefined);
    } else {
      add('Working tree', dirty ? 'warn' : 'ok', dirty ? 'uncommitted changes present' : undefined);
    }
  } catch {
    add('Working tree', 'warn', 'not a git repo?');
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function printChecks(checks: Check[]): void {
  console.log('\nPreflight checks:');
  for (const c of checks) {
    const detail = c.detail ? `  ${DIM}${c.detail}${RESET}` : '';
    console.log(`  ${COLOR[c.status]}${ICON[c.status]}${RESET} ${c.label}${detail}`);
  }
}

const checks = await runChecks();
printChecks(checks);

const failures = checks.filter((c) => c.status === 'fail');
const warnings = checks.filter((c) => c.status === 'warn');

if (failures.length) {
  console.log(`\n${COLOR.fail}${failures.length} blocking issue(s) — fix before releasing.${RESET}`);
  process.exit(1);
}

if (checkOnly) {
  console.log(`\n${COLOR.ok}Config looks good.${RESET}${warnings.length ? ` (${warnings.length} warning(s))` : ''}`);
  process.exit(0);
}

const current = readPkgVersion();
const next = bumpVersion(current, bump);
console.log(`\nBump (${bump}): ${current} → ${COLOR.ok}${next}${RESET}`);

if (dryRun) {
  console.log(`${DIM}--dry-run: no files written.${RESET}`);
  process.exit(0);
}

writeVersion(next);
console.log(`Updated package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml.`);

const tag = `v${next}`;

if (doTag) {
  // Refuse to clobber an existing tag.
  const existing = await $`git tag -l ${tag}`.quiet().nothrow();
  if (existing.stdout.toString().trim() === tag) {
    console.log(`\n${COLOR.fail}Tag ${tag} already exists.${RESET} Files were bumped; resolve the tag manually.`);
    process.exit(1);
  }
  await $`git add ${PKG} ${TAURI_CONF} ${CARGO}`;
  await $`git commit -m ${`chore: release ${tag}`}`;
  await $`git tag -a ${tag} -m ${`Notch ${tag}`}`;
  console.log(`Committed bump and created tag ${COLOR.ok}${tag}${RESET}.`);

  if (doPush) {
    const branch = (await $`git rev-parse --abbrev-ref HEAD`.quiet()).stdout.toString().trim();
    await $`git push origin ${branch}`;
    await $`git push origin ${tag}`;
    console.log(`Pushed ${branch} and ${tag}. ${DIM}CI will build the draft release.${RESET}`);
  } else {
    console.log(`\nNext: ${DIM}git push origin HEAD && git push origin ${tag}${RESET}`);
  }
} else {
  console.log(`\nNext steps:`);
  console.log(`  ${DIM}git add -A && git commit -m "chore: release ${tag}"${RESET}`);
  console.log(`  ${DIM}git tag ${tag} && git push origin HEAD ${tag}${RESET}`);
  console.log(`  ${DIM}(or re-run with --tag to commit+tag automatically)${RESET}`);
}
