# Native Quiver comparison — September 20, 2026

Tested merged main at `c8b783b` in a freshly rebuilt native package:
`src-tauri/target/debug/bundle/macos/Notch QA.app`. Build succeeded with
embedded production frontend assets, a separate QA identifier, and updater
artifacts disabled. This is a debug native package, not the signed release.
The library was `~/dev/notch_libraries/Notch Daily.notch`. Quiver was
`/Applications/Quiver.app`, using its existing QA comparison notebook.

The previous fixes substantially improve ordinary use, but four issues remain
in the exercised flows. No application source was changed in this audit.

## Findings

### P1 — Immediate input after code-cell insertion can still reach the old cell

1. Create a Code Cell and paste `const parity = 42;`, a blank line, and
   `console.log(parity);`.
2. Press Shift+Return and immediately paste `// After code sentinel`.
3. A new empty code cell appears, but the pasted text is appended to the old
   cell: `console.log(parity);// After code sentinel`.

This reproduced twice through consecutive native keyboard/paste actions. The
second trial inserted `// Immediate second trial` into the preceding cell rather
than its newly created successor. Input sent after observing the settled UI
correctly reaches the new cell. Thus the persistent focus failure from the first
audit is improved, but a transition race remains. Its timing threshold and
behavior with physical typing have not been measured.

The native Markdown export confirms the misplaced text is saved, rather than
being an accessibility-tree artifact. Quiver's corresponding immediate
Shift+Return/paste sequence correctly placed `After code sentinel` in the new
Text Cell. Quiver defaults to Text after insertion; Notch preserves Code.

Investigate the asynchronous Monaco creation/focus path in
`src/components/Editor/cells/CodeCell.tsx` and insertion in
`src/components/Editor/NoteEditor.tsx`. The old input target must not accept
subsequent editing while the new target initializes.

### P2 — Markdown toolbar formatting is outside the usable undo history

In `QA Round 2 Keyboard`, enter `Alpha`, a blank line, and `Beta`. Remove the
blank line with Backspace, select `Beta`, then click Bold. Notch correctly
produces `**Beta**`, but Cmd+Z leaves it unchanged. Clicking back into the
Markdown editor and pressing Cmd+Z again also does nothing.

In Quiver, select `Beta` in a Markdown cell, click Bold, then press Cmd+Z:
the `**` markers are removed. This is a direct parity failure for an ordinary
editing operation. Notch code-cell paste undo and redo passed separately.

Investigate how toolbar changes in `src/components/Editor/NoteEditor.tsx`
participate in editor undo history; correct text transformation alone is not
sufficient validation.

### P2 — Small flowcharts are excessively enlarged

Render `flowchart TD` with `A[Start] --> B[Finish]`, then switch to Preview.
At the normal approximately 1200-by-800 window, the two nodes and arrow become
large enough to require multiple screens of vertical scrolling. The Start and
Finish labels are enormous. This persisted across preview changes and restart.
The arrow now has good contrast; sizing is the remaining problem.

Quiver's corresponding `st=>start: Start`, `e=>end: Finish`, `st->e` flowchart
renders as a compact diagram fully visible below the other cells, even in its
wider window. Preserve an appropriate intrinsic diagram size and constrain
large diagrams to the available pane. Relevant code is
`src/services/diagrams.ts`, `src/components/Preview/NotePreview.tsx`, and
`.diagram-preview` in `src/styles/index.css`; the exact sizing cause remains
to be diagnosed.

### P3 — Empty rich-text cells show an editing prompt in Preview

After a rich-text cell, press Shift+Return while in Side by Side mode. The new
empty Text Cell displays `Type here...` in both the editor and the read-only
preview. The preview should not display an instruction to edit.

Source corroboration: `NotePreview.tsx` assigns `cell-richtext` to rendered text
cells, while `.cell-richtext:empty::before` in `src/styles/index.css` adds the
placeholder without limiting it to editable elements. This observation is a
visual placeholder leak, not evidence that placeholder text was saved.

## Checks that passed in this pass

| Flow | Result |
| --- | --- |
| Fresh native package from merged main | Build and launch passed |
| Correct library | Notch Daily retained and displayed |
| New note, title, Return into body | Passed |
| Formatted HTML paste | Bold, italic, link, and paragraphs readable in dark editor and preview |
| Markdown rendering and cell conversion | Exercised successfully |
| Code conversion and multiline layout | Source and line numbers rendered immediately; blank line retained |
| Code input after settled insertion | Correct new-cell destination |
| Code undo and redo | Paste removed and restored with native shortcuts |
| Markdown blank-line Backspace | Removed the blank line correctly |
| Markdown Bold button | Correct markup produced; undo failure above |
| LaTeX | Formula rendered in editor and preview; exported source retained |
| Diagram contrast | Connector visible; sizing failure above |
| Global search | Later-cell `sentinel` matches shown in highlighted excerpts |
| Search Return navigation | Opened matching note |
| In-note find | `1 of 3` and all three highlighted matches visible |
| Duplicate | Copy selected and counts increased |
| Trash | Synthetic duplicate removed and next note selected |
| Restore | Copy returned to its notebook; Trash emptied and counts restored |
| Settings | Fits normal window and closes with Escape |
| Assistant layout | Disabled assistant visible; view controls retained; narrow split panes stack |
| Quit and reopen | Library, notebook, selected note, Preview mode, and content retained |
| Native Markdown export | Save chooser and completion alert passed; saved contents inspected |

The export is at
`src-tauri/target/qa-fixtures/QA Parity Round 2.md` (ignored build artifact).
It contains rich-text HTML, code blocks, the formula, and Mermaid source. It
also records the input-destination failures above.

## Retained test data and limits

Notch now has three additional synthetic notes: `QA Parity Round 2`, its
restored `QA Parity Round 2 Copy`, and `QA Round 2 Keyboard`, in the existing
QA notebook. Quiver has two additional synthetic comparison notes. Original
user notes were not edited. No permanent deletion was performed.

This pass does not repeat the previous full backup/restore and Quiver-library
import tests, nor validate updater installation, signing/notarization, crashes,
offline/network behavior, all drag/drop paths, or enabled assistant requests.
Native-control clipboard timeouts and stale accessibility entries occurred;
ambiguous operations were checked through screenshots or export before being
classified. The debug build automatically opens its inspector on launch; that
was dismissed and is not classified as a release defect.

Known broader gaps documented in `QA-FIXES.md` remain: separate note windows,
floating preview, presentation mode, arbitrary attachments, more import/export
formats, and shared/file-based synchronization. Quiver's larger note-action
menu was inspected again; this audit does not claim those complete workflows
were all exercised.

## Fixes and performance follow-up — September 21, 2026

Implemented all four findings and retested with a native **optimized** build
at `src-tauri/target/release/bundle/macos/Notch QA.app` (same separate QA
identifier and Notch Daily library). This package is local and has not been
published as a new release.

- Cell insertion publishes the new cell immediately. Per-note SQL insertion
  barriers preserve insertion/edit order, and an immediately usable textarea
  hands its value, selection and focus to Monaco once ready. Three consecutive
  native Shift+Return/immediate-paste sequences populated the correct cells.
  A read-only SQLite check confirmed all three sentinels persisted separately.
- Markdown toolbar edits use native `insertText` transactions. Native Bold →
  Cmd+Z → Cmd+Shift+Z removed and restored the markers correctly.
- Rich-text sanitization now has a private DOMPurify instance. Its global style
  hook had also stripped Mermaid's sizing styles. The two-node native preview
  now fits compactly on one screen, with a readable arrow.
- The empty-text placeholder is restricted to editable elements. Native split
  view shows it in the input only, leaving the empty preview cell blank.

### Performance findings and changes

The old preview recomputed syntax highlighting, Markdown, and math for every
cell on each keystroke, and its effect redrew every diagram whenever any cell
changed. Preview cells are now memoized independently using the unchanged cell
objects retained by the store. Diagrams update only when their own source/type
changes, wait for a short typing pause, and share a bounded cache of in-flight
and completed renders. Returned SVG instances use distinct IDs. Failed renders
are evicted so corrected/retried diagrams are not stuck behind a cached failure.

Code editing also forced a full Monaco layout/render after every local input
change. Local edits now use Monaco's own incremental rendering; explicit layout
remains for mounting, resizing, height changes, and externally applied values.
Cell insertion no longer waits for the native SQL round trips before making the
new input available.

### Measured preview update cost

A production-React browser harness compared the previous `NotePreview` from
`c8b783b` with the new component. The synthetic note contained 20 unchanged
JavaScript cells of 40 lines each plus one edited Markdown cell. Each run made
30 edits, with a frame between updates. Measurements cover synchronous React
render/commit work, not native input latency, SQL, app startup, or Quiver speed.
Shared services were the current versions for both components; no diagrams or
resources were present, isolating the per-cell memoization change.

| Run | Before median / p95 | After median / p95 |
| --- | --- | --- |
| 1 | 4.9 / 6.6 ms | 0.2 / 0.3 ms |
| 2 | 5.0 / 5.8 ms | 0.3 / 0.6 ms |
| 3 | 5.1 / 6.0 ms | 0.3 / 0.7 ms |

Harness and raw results are retained under the ignored
`src-tauri/target/qa-performance/` directory. These results support reduced
preview work; they do not establish overall speed parity with Quiver. Large
libraries, very large numbers of Monaco editors, startup, and per-keystroke
search-index database work remain candidates for broader profiling.

### Validation

- 113 Bun tests passed, including real SQLite integration verifying that rapid
  insertions and immediate edits persist in the correct cells/order.
- Added cache tests for shared pending work, repeated visits, bounded eviction,
  and retries after errors.
- TypeScript and whitespace checks passed.
- Optimized Tauri app packaging passed; the native checks above ran against an
  optimized package rather than the older inspector-enabled debug package.
- Retained synthetic note: `QA Round 2 Fix Verification`. Original user notes
  were not edited. The prior synthetic Markdown note was used for undo/redo.
