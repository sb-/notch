# Quiver parity implementation verification — September 25–26, 2026

Local optimized Notch QA build, using the separate **Notch Daily** library.
Includes the previous round-3 fixes and the requested round-4 implementation.

## Implemented

- Search indexing: serialize writes per note, batch whole-note indexing within
  a 300 ms window, replace each entry atomically using the note's row ID, and
  repair historical duplicate/stale entries on migration. Search, library
  changes, previews, and normal app exit flush pending work. Cell content is
  still written immediately; only search indexing is deferred.
- Cell splitting at the caret for rich text, Markdown, code and source-based
  cells. Rich text retains formatting and resource references.
- Cell cut/copy/paste, reorder, delete, and structural undo/redo. Cell metadata
  and embedded resources survive in-app copying. Clipboard text remains usable
  elsewhere. Structural history is bounded to 100 operations per note and is
  session-local; Cell → Undo Cell Change also works after content edits.
- Back/Forward note history, including branching and skipping trashed notes.
  Search and internal links record their destination as a single navigation.
- Optional bidirectional editor/preview scroll synchronization, remembered per
  library. It maps proportional scroll positions, not exact source lines.
- Floating live preview and a separate PDF preview, with bundled math/code
  styling, rendered diagrams, and embedded images. PDF saving uses the macOS
  print dialog's PDF button. PDF preview holds a snapshot; floating preview
  follows the selected note and edits.

## Native verification

- Markdown split at `After split`: two cells with exact before/after text;
  Cmd+Z and Cmd+Shift+Z restore and redo the structure.
- Rich-text split at `Second paragraph`: bold/italic/link formatting and the
  embedded image survive. Fixed an initially stale original editor DOM;
  retested the corrected editor and undo.
- Split the 1,000-line JavaScript fixture after its first line: verified exact
  persisted text boundaries and JavaScript language on both cells; undid it.
- Copied/pasted the image Markdown cell in `QA Native Rich Text`: new resource
  ID with a rendered image; undo removed the pasted cell.
- Cmd+Option+Return/C/X/V: split/copy/cut/paste work. Consecutive Cmd+Z restores
  cut content and removes the pasted duplicate.
- Back and Forward buttons return to the correct notes.
- Scrolled the 1,000-line fixture from both panes with sync enabled; both panes
  show the same approximate region. With sync disabled, one pane stays put.
  Fixed a reverse-scroll guard that depended on suspended background animation
  frames. The setting survived relaunch; restored it to off after testing.
- Exported `/private/tmp/Notch Feature Verification.pdf` and
  `/private/tmp/Notch Mixed Feature Verification.pdf` through the native print
  and save dialogs. Rendered and visually inspected their pages: title, prose,
  highlighted code, equation, and flowchart appear without app chrome.
- A read-only check of Notch Daily after migration found zero notes with
  duplicate search index entries.
- Floating preview received a `LIVE-PREVIEW-PROBE` edit while minimized and
  showed it when restored without rerendering through the open-preview action.
- Long-PDF verification caught WKWebView truncating the final 110 lines when
  margins were supplied through CSS. Moved margins into native NSPrintInfo:
  `/private/tmp/Notch Long Note Complete.pdf` has 23 pages and its extracted
  text and rendered final page include `item999` and `// END-PROBE`.
- `/private/tmp/Notch Image Export Verification.pdf` includes both embedded
  images from the rich-text/Markdown resource fixture; rendered and inspected.
- `/private/tmp/Notch Mixed Final.pdf` confirms bullet markers, code, math,
  and diagram layout after the native-margin fix.
- Closed the main window after observing `PLAIN-UPQ` in the editor. Read-only
  SQLite inspection confirmed the cell and one matching search entry; relaunch
  showed that same text. Removed the test suffix afterward.
- Native global search for `PLAIN-UP` now shows exactly one result, versus
  three in the audit. Final Window menu exposes Note Editor and Floating Preview.

## Automated and performance verification

- `bun test`: 114 tests pass. The isolated SQLite integration test includes ten
  scenario groups, including overlapping edits, index repair, atomic cell
  replacement failure, UI recovery after failed replacement, consecutive undo,
  preserving edits in unaffected cells, and navigation history branching.
- `bunx tsc --noEmit` and `git diff --check` pass.
- Optimized Tauri macOS app builds successfully.
- The same in-memory SQLite probe from round 4 now reports **62 SQL calls**
  for 30 edits versus **210** before. Whole-note indexed content falls from
  **1,940,535 bytes** to **64,699 bytes** (about 97% less). Thirty overlapping
  edits leave one index row and one search result. These measure database work,
  not end-to-end UI latency or an overall speed ratio against Quiver.

All native mutations were confined to existing synthetic QA notes; original
user notes were not edited. Split/cut/paste tests were undone afterward.
