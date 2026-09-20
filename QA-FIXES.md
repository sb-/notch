# Quiver comparison: implemented fixes

Updated September 19, 2026. This records implementation and retesting after
[the native audit](QA-NATIVE-AUDIT.md); that document preserves the original failures.

## Task results

| Task | Change | Verification |
| --- | --- | --- |
| Packaged startup and local editor assets | Build the real application entry explicitly; bundle Monaco and serve its workers locally. | Production frontend embedded in a native QA package opens successfully. |
| Code editing and focus | Initialize Monaco in a visible measured host, render synchronously without depending on animation frames, synchronize height/focus/current callbacks, and handle Shift+Return before Monaco. | Native fresh note switches render both cells immediately; five-line paste expands the cell; Shift+Return creates/focuses a new cell and subsequent typing updates it and Preview. Earlier unsuccessful candidates were discarded. |
| Rich text and images | Normalize pasted default black/white text to the theme while retaining accents; insert selected images at the rich-text caret. | Previously black text is legible in Editor/Preview. Native image chooser adds an image inside the existing text cell; image persists across restart. |
| Title and formatting | Return in title enters the body; implement supported Markdown/Text formatting; hide unsupported controls for math/diagrams. | Native title-to-body entry passed; pure formatting regression tests cover selection and caret behavior. |
| Diagrams and preview | Convert supported legacy Quiver diagram syntax for rendering, preserve source, improve connector contrast, remove temporary Mermaid diagnostics, and omit duplicate split-view title. | Native import of Quiver tutorial: sequence diagram and flowchart render with readable arrows; source conversion regressions pass. |
| Native import | Explicitly grant recursive access to the selected package only; report unreadable/failed items instead of a false zero-note success. | Native chooser imported all 12 tutorial notes into one notebook. Error/partial-import behavior tested against SQLite with failing resource reads. |
| Note recovery and duplication | Native/context actions for Duplicate, Move to Trash, Restore; correct menu availability; independent copied resources. | Native duplicate → Trash → Restore updates counts and menu availability. SQLite regressions verify duplicated image independence and recovery selection. |
| Safe notebook removal | Move notes from the whole subtree, including already-trashed notes, to Inbox/Trash atomically, preserve resources/tags, and refresh store selection. | Real SQLite tests cover nested notebooks, preexisting trash, injected trigger failure, and rollback. Permanent notebook removal was not exercised on the user library. |
| Complete backup and restoration | Versioned validated backups include hierarchy, tags, trash, cells, and resource bytes. Restore atomically into a new empty library; recover loading/error state on failure. | Native export → native restore created a separate library with 18 notes, 7 notebooks, and 17 resources. Every resource's bytes matched. SQLite tests additionally cover trash, favorites, tags, search, nonempty rejection, failed restore rollback, and retry. |
| Navigation and preferences | Persist view/filter/selection per library; use the displayed sort when selecting a notebook, tag, or collection. | Native restart retained Preview and tutorial selection; switching libraries restored the previous notebook. SQLite regressions cover per-library preferences and sorted selection. |
| Search excerpts | Show context around a matching term, including matches in later code cells, and highlight it as escaped React text. | Native search for `answer` shows the matching code and highlights the term; Return opens the correct note. Six regressions cover later-cell matches, rich-text entities, source-code angle brackets, and safe highlighting. |
| Settings, assistant and menus | Escape/focus handling, constrained settings controls, responsive toolbar, stacked narrow split panes, newly created notebook selection, and transient-menu dismissal. | Native Settings fits and closes with Escape; assistant layout leaves cell labels and all three view controls visible; notebook creation selects its destination. |

## Build and tests

- TypeScript checking passed.
- Bun regression suite: **111 passed, 0 failed**, 212 assertions across 16 files, including the real SQLite integration subprocess.
- Tauri debug app packaging passed with embedded production frontend assets.
- Whitespace/error check passed.

The tested package is `src-tauri/target/debug/bundle/macos/Notch QA.app`, with a
distinct `com.notch.qa` identifier and window title. It is a development build,
not a signed release. The installed application was not replaced. All changes
remain uncommitted, including the user's earlier changes.

## Retained QA data

Testing used **Notch Daily**, under `~/dev/notch_libraries`. Original notes
`Daily Notes` and `Fireworks.ai` were not edited. Synthetic notes and notebooks
from the audit remain, plus `QA Fix Verification`, its two code notes, and the
12-note `Quiver Tutorial`. A sample image was added to `QA Native Rich Text`.

The native backup, copied tutorial fixture, image sample, and restored test
library are under the ignored `src-tauri/target/qa-fixtures` directory. The
restored library is separate from Notch Daily. These build-directory fixtures
are verification artifacts, not a durable backup strategy.

## Remaining parity and release coverage

This is not a claim of complete Quiver equivalence. Separate windows/floating
preview, presentation mode, arbitrary attachments, additional import/export
formats such as PDF/PNG, and shared/file-based synchronization remain feature
gaps. Complex legacy diagrams outside the supported conversion subset show an
actionable error rather than silently changing their saved source.

Signed-release installation, updater installation, crash recovery, every
drag/drop path, every keyboard shortcut, and enabled paid assistant conversations
were not covered by this fix pass. Background resource hydration can still emit
a transient unsupported `notch-resource` URL warning before an image resolves.
