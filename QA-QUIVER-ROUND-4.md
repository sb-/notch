# Quiver functionality and performance comparison — September 25, 2026

Compared Quiver 3.2.7 at `/Applications/Quiver.app` with the optimized local
Notch QA bundle at `src-tauri/target/release/bundle/macos/Notch QA.app`.
Notch includes the three uncommitted round-3 fixes and uses **Notch Daily**.
Native UI control was used for the interactions below. No application source
was changed in this audit; earlier uncommitted fixes remain intact.

## Highest-priority finding: indexing work and duplicate search results

Notch does substantially more persistence/indexing work during a typing burst
than Quiver's frontend save scheduling requires. This is a confirmed work
difference, not a measured end-to-end latency ratio.

The installed Quiver editor code at
`/Applications/Quiver.app/Contents/Resources/dist/js/editor.js` wraps its cell
content-change callback in a 300 ms debounce and its save callback in a
1,000 ms debounce. Its debounce helper also exposes cancellation and immediate
flushing. Saving serializes the note and calls `NativeApp.saveNoteContent` only
when the serialized content changed. This inspection does not establish how
Quiver's native backend performs disk I/O or indexing.

Notch's `CellContainer` calls store `updateCell` on every editor change. That
calls database `updateCell`, which performs seven SQL operations: write the
cell, update the note timestamp, read the note, read its cells, read its tags,
delete its search entry, and insert the whole note's search entry.

A controlled probe used the real Notch database service with an in-memory
SQLite transport and a synthetic 1,000-line, 64,669-byte note:

| Workload | Observed work |
| --- | --- |
| 30 sequential one-character edits | 210 SQL calls |
| Search-index rebuilds | 30 whole-note inserts, totaling 1,940,535 content bytes |
| 30 concurrent edits to one cell | 30 index rows for one note; search returned that note 30 times |

The concurrent case exposes the separate delete/insert race in
`src/services/database.ts`'s `updateNoteFTS`. Multiple updates can delete before
any inserts finish, then each inserts its own row. This is not confined to the
probe: a read-only check of Notch Daily found three index rows each for
`QA Release 0.3.1 — Larger Note` and `QA Round 3 Fix Verification`.
The native global search for `PLAIN-UP` displayed **QA Round 3 Fix Verification
three times**, with identical current-content excerpts.

Recommended first work: serialize/coalesce per-note persistence and make index
replacement atomic; repair existing duplicate/stale entries. Keep immediate
editor feedback and explicitly flush pending saves at lifecycle boundaries.
Add overlapping-update tests. Debouncing alone does not fix the race.

Probe and raw results are retained under the ignored
`src-tauri/target/qa-performance/round4/` directory. SQLite-only timing there
excludes Tauri IPC, disk, React, rendering, and input latency; it is not used as
an app-speed benchmark. The probe writes only to its in-memory database.

## Confirmed functionality differences

| Workflow | Quiver evidence in this pass | Notch status |
| --- | --- | --- |
| Split a cell at the caret | Split `Before split` / `After split` into separate Text cells; Undo restored one cell containing both lines | No split operation in editor, store, or native menus |
| Cell clipboard and structural undo | Cut Cell removed the synthetic recovery cell; Cmd+Z restored the complete cell | No cell-specific cut/copy/paste commands; app-level undo covers conversion, while content undo belongs to individual editors |
| Navigation history | Selected another note and clicked Back; returned to the feature fixture and Forward became available | No Back/Forward history controls or store history |
| Synchronized split scrolling | Enabled View → Note View → Scroll Sync; scrolling near line 770 moved both editor and preview to that region | Editor remained near line 900 while preview stayed near line 1; no equivalent menu/control or scroll handler |
| Floating preview | Opened an independent Preview window containing the synthetic note, then closed it | Single main window; no floating preview action |
| PDF export | Exported the synthetic note through the native Save chooser to `/private/tmp/QA Quiver Feature Pass 4.pdf`; file is a one-page PDF | No PDF/PNG export option |
| Editor configuration | Inspected Code Cell preferences: theme, tab width, line numbers, invisibles, indent guides, soft tabs, key binding | Settings currently contains Assistant controls; Monaco theme, font size, tab width, etc. are fixed in code |

The cell operations, history, scroll synchronization, and configurable code
editor are the most useful additions to the previous gap list. Floating
preview and PDF export were already known gaps; this pass exercised their
Quiver workflows rather than only noting menu items. PDF generation and file
type were verified; page layout was not visually reviewed.

Other inspected Quiver menus expose Copy Note as HTML/Markdown/plain text/code
only, new-cell-at-cursor/above, compact note-list style, presentation, and
separate note windows. These were not all exercised end to end in this pass.
Quiver's Backup preferences exposed manual Backup Now and Restore controls;
this pass does **not** establish automatic scheduled backups.

## Larger-note observations and further profiling

Both apps accepted and rendered the same generated 1,000-line JavaScript code
cell and allowed scrolling in split view. Notch also accepted a trailing
`END-PROBE` edit. The two short preceding prose cells used Quiver Text cells
and Notch Markdown cells, so this is not a strictly identical benchmark.
Different window sizes, themes, and accessibility overhead further prevent
using tool-call durations as comparative latency measurements. No crash or
sustained hang was reproduced, and no overall speed winner is claimed.

Two additional Notch profiling targets are visible in source:

- Global search starts a new query on each input change, hydrates matching
  notes, has no result cap at this call site, and lacks a stale-response guard.
  Measure this on a large library before asserting a Quiver speed advantage.
- Each mounted Code Cell creates its own Monaco editor/model and disposes them
  on unmount. Large notes and view changes may incur repeated editor setup.
  Profile editor mount cost and off-screen cells; the one-cell test here does
  not quantify this cost.

## Suggested order and retained data

1. Fix duplicate/stale indexing and reduce per-keystroke SQL work.
2. Add cell split/clipboard operations with structural undo.
3. Add note history and optional synchronized scrolling.
4. Add editor preferences and the already-known window/export features.

New synthetic fixtures: Quiver `QA Quiver Feature Pass 4` in its QA comparison
notebook, and Notch `QA Feature Pass 4 — 1000 lines` in
`QA Native 2026-09-08`. The Quiver PDF was exported before the large code cell
was added. Original user notes were not edited. Quiver's scroll-sync setting,
pane arrangement, and editor-only view were restored after testing.
