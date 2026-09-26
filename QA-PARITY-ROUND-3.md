# Published 0.3.1 native QA — September 25, 2026

Tested the published universal macOS 0.3.1 application, from tag `v0.3.1`
at `5deabb8e48a3e5a9103421b9e3856c1c3f6da7fa`, against
`/Applications/Quiver.app` through native UI control.

The exact bundle tested was
`src-tauri/target/release-verification-0.3.1/Notch.app`, using the separate
`~/dev/notch_libraries/Notch Daily.notch` library. The downloaded app archive's
SHA-256 matched the published asset digest:
`2c39dfd1d13b3d6feab422d8de6019846deb171b04e2d6b738db0f7ddde292e8`.
GitHub reports the release is published, and the bundle reports version 0.3.1.
This pass did not rebuild the application or modify application source.

## Confirmed findings

### P2 — Modified arrow selection can send subsequent typing to another cell

1. Create two Markdown cells. Put `Alpha` and `**Beta**` on separate lines in
   the first, and `Third cell sentinel` in the second.
2. In the second cell, press Cmd+Left to reach the beginning of its first line.
3. Press Shift+Up, then type `SELECTION-PROBE`.

Notch moves focus to the preceding cell and appends the probe after `**Beta**`.
The second cell is unchanged. A read-only database check confirmed this text
was saved in the first cell; this was not only an accessibility-reporting issue.

Quiver kept focus in the second Markdown cell through the same shortcut
sequence and inserted the probe before `Third cell sentinel`. Its first cell
remained unchanged.

Source corroboration: `src/components/Editor/cells/MarkdownCell.tsx:131`
handles ArrowUp/ArrowDown at cell boundaries without checking Shift, Command,
Option, Control, or whether a selection exists. Modified selection shortcuts
should retain their native editing behavior. Both directions and existing
selections need regression coverage; this pass directly reproduced Shift+Up.

### P2 — Markdown Tab indentation still bypasses undo

1. Put `Third cell sentinel` in a Markdown cell and place the caret at its end.
2. Press Tab. Notch inserts two spaces.
3. Press Cmd+Z.

The inserted indentation remains. In Quiver, Tab followed by Cmd+Z removes the
indentation. Notch's Markdown toolbar Bold undo/redo passed separately, so the
0.3.1 formatting fix does not cover this other programmatic editing path.

Source corroboration: `src/components/Editor/cells/MarkdownCell.tsx:146`
handles Tab by calling `onChange(newValue)` and moving the selection later,
outside a native undo transaction. Use the same undo-aware editing principle
as toolbar formatting and check indentation undo/redo through the native app.

### P2 — Hyphenated global searches miss text that is present

1. Add `fresh-index-r3` to a note's Markdown cell.
2. Open Search All Notes and search for `fresh-index-r3`.
3. Change the search to `fresh`.

The full term returns **No results found**; the first word finds the note and
shows the full term in its excerpt. Quiver finds its comparison note when
searching for the complete `fresh-index-r3` string.

This is query normalization, not delayed indexing. At
`src/services/database.ts:1055`, punctuation stripping changes the input to
`freshindexr3`, joining tokens that SQLite indexed separately. A read-only
query against the test library after duplicating the note confirmed:

| FTS query | Matches |
| --- | ---: |
| `"fresh-index-r3"*` | 2 |
| `"freshindexr3"*` | 0 |
| `"fresh"*` | 2 |

Literal punctuation should be escaped/quoted safely without changing token
boundaries. Real SQLite coverage should include hyphenated words and code-like
terms rather than only mocked search results.

## Release regression checks

All four fixes from the previous round passed their exercised release checks:

| Area | Native result |
| --- | --- |
| Markdown toolbar undo/redo | Bold markers removed by Cmd+Z and restored by Cmd+Shift+Z |
| Immediate cell insertion | Two consecutive Code Shift+Return/immediate-paste operations populated separate new cells; database confirmed content and order |
| Diagram sizing | Compact two-node diagram fits in editor, Preview, and split view; connector readable |
| Empty rich-text preview | `Type here...` appears only in editable cell; corresponding preview stays blank |

Additional checks:

| Flow | Result |
| --- | --- |
| Markdown Shift+Return/immediate paste | Correct new-cell destination |
| Code paste undo/redo | Removed and restored content correctly |
| Immediate empty code-cell Backspace | Removed just the new empty cell |
| Invalid Mermaid source | Visible parse error and actionable preview message |
| Correcting Mermaid source | Recovered to `Recovered → Ready`; error cleared |
| Diagram note switching | Correct diagram returned after visiting another note |
| In-note find after editing | Match count changed from one to two; preview text reflected edit |
| Plain-token global search after editing | Found newly inserted text and highlighted excerpt |
| Tag creation and navigation | New tag applied and filtered to matching note |
| Favorite toggle | Button and sidebar count updated |
| Duplicate | New note selected with copied cells and tag |
| Move | Duplicate appeared in destination QA notebook; notebook counts updated |
| Trash and restore | Next note selected on trash; restore returned duplicate to its destination notebook and emptied Trash |
| Quit/reopen | Correct library, notebook, selected note, tag, content, and split view retained |
| Published updater | Help → Check for Updates reported “No Updates Available” and latest version |

## Larger-note and automated checks

A separate synthetic note contains three 80-line JavaScript cells, inserted
through native paste with immediate Shift+Return transitions. All three were
saved separately and in full; a subsequent typing probe increased the first
cell to 81 lines. Editing with split preview active and switching back to the
smaller mixed note completed without a reproducible hang or lost input.

This is a functional stress check, not a latency benchmark. Native automation
includes input and observation overhead; its call durations are not app frame
times. This pass does not establish overall speed parity with Quiver, nor
exercise a large library or hundreds of mounted editors. The prior measured
preview-render improvement remains documented in `QA-PARITY-ROUND-2.md`.

- `bun test`: 113 passed, 0 failed, 219 assertions across 17 files.
- `bunx tsc --noEmit`: passed.
- No application source changes were made during this audit.

## Retained fixtures and limits

Notch retains three new synthetic notes:

- `QA Release 0.3.1 — Round 3`, in `QA Native 2026-09-08`.
- `QA Release 0.3.1 — Larger Note`, in the same notebook.
- `QA Release 0.3.1 — Round 3 Copy`, restored in `QA Fix Verification`.
  This copy also contains the later empty-rich-text preview test cell.

The tag `qa-release-r3` is attached to the two mixed notes; the original round-3
note is favorited. Quiver retains `QA Release Round 3` in its existing QA
comparison notebook. Original user notes were not edited. Nothing was
permanently deleted.

Not repeated in this pass: full backup/restore and library import, export
formats, image/file drag-and-drop, enabled assistant requests, network failures,
or installing an update over an older version. The updater check verifies the
current-release path only. Broader pre-existing Quiver feature gaps remain
documented in the earlier audits.

## Fixes and native retest — September 25, 2026

Implemented all three findings and tested the rebuilt optimized application at
`src-tauri/target/release/bundle/macos/Notch QA.app`, identifier `com.notch.qa`,
with the same Notch Daily library. The old QA process was quit and the new
bundle relaunched before testing. These changes are local, not a new release.

- Markdown cell navigation now requires an unmodified arrow key, a collapsed
  selection, and no active composition. Native Shift+Up and Shift+Down probes
  stayed in the second cell. Command+Up/Down and Up with an existing selection
  also stayed there. Plain Up/Down still moved between cells correctly.
- Tab inserts spaces through WebKit's native `insertText` transaction. For
  pasted `Indent sentinel`, Tab → Cmd+Z removed only the two spaces;
  Cmd+Shift+Z restored them. Adjacent typing can share an undo transaction with
  indentation, consistent with WebKit's native undo grouping; both were restored
  together when tested immediately after a typing probe.
- Search quotes and escapes terms without deleting internal punctuation.
  Search excerpts share the same term preparation. The native full query
  `fresh-index-r3` now found both retained audit notes, highlighted the whole
  term in both excerpts, and opened a matching note with Return.

Added real SQLite integration cases for hyphens, colons, parentheses, embedded
quotes, accented and Japanese text, prefix queries, punctuation-only input,
distinct joined tokens, and exclusion of trashed results. Added an excerpt
regression for a hyphenated term in later-cell content.

Validation: 114 Bun tests passed (221 assertions reported by the parent suite,
plus isolated SQLite assertions), TypeScript and whitespace checks passed,
and optimized native packaging succeeded. Retained new synthetic note:
`QA Round 3 Fix Verification` in `QA Native 2026-09-08`.
