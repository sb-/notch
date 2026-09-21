# Native Notch / Quiver UI audit — September 8, 2026

Notch's core note workflows work, but native testing found several material editing and presentation defects. It is not yet equivalent to Quiver. Fix unreadable rich-text paste, code-cell focus/layout, native import reliability, and missing note recovery actions before spending time on minor visual refinements.

## Environment and scope

- Tested the current-source development binary in `/private/tmp/Notch QA.app`, using real Tauri/WebKit, native keyboard/clipboard, menus, file choosers and SQLite. The frontend runs at `localhost:1420`; this is not a packaged-release smoke test.
- Opened `/Users/samb/dev/notch_libraries/Notch Daily.notch` through the native chooser. Verified the user's original two notes before creating test content. Original note contents were not edited.
- Compared directly with `/Applications/Quiver.app`, using the previously created `QA Compare 2026-09-07` notebook.
- Do not conflate this with the old project release bundle, whose updater reports version 0.1.1. The earlier browser/service audit and release-build failure remain in [QA-AUDIT.md](QA-AUDIT.md).
- Native control occasionally returned stale accessibility trees, dropped rapid keyboard input, or clipboard timeouts even when paste succeeded. Results were checked visually and, for exported/persisted synthetic content, on disk. Ambiguous typing/undo observations are not classified as product defects.

## Highest-priority native findings

### P1 — Formatted paste becomes black text on a dark background

In a Text Cell, paste HTML containing ordinary paragraphs, bold, italic and a link. Both editor and preview render paragraph text nearly black against the dark surface. The link remains blue. Switch notes and restart: the problem persists.

The exact test payload was `<p>Alpha <strong>bold</strong> <em>italic</em> <a href="https://example.com">example link</a></p><p>Second paragraph</p>`. The native clipboard introduces styling; the saved QA cell contains `style="color: rgb(0, 0, 0); white-space: normal;"`. Plain-text paste in a fresh cell appeared in the normal light text color. Quiver displayed the identical formatted clipboard content readably in its current light appearance.

Normalize inherited/default clipboard foreground colors for the active theme while preserving deliberate formatting. Relevant code: `src/components/Editor/cells/TextCell.tsx`, `src/services/html.ts` (`color` is an allowed inline style). This does not establish how Quiver handles every explicit color in dark mode.

### P1 — Shift+Return inserts a code cell but typing stays in the old cell

Create a Markdown cell, insert another cell, convert it to Code, enter `const answer = 42;`, press Shift+Return, then paste `// second cell`. A new cell appears, but the first code cell becomes `const answer = 42;// second cell` and the new one remains empty. Exported Markdown confirms that content destination.

Quiver's corresponding Shift+Return creates and focuses a new Text Cell. Notch also differs by inserting another Code Cell. Focus is the defect; which cell type should be inserted is a product decision.

`src/components/Editor/cells/CodeCell.tsx` declares `isFocused` but neither consumes it nor calls editor focus when it changes. Markdown and Text Cell insertion moved input into the new cell in the tested cases.

### P1 — Newly converted code editors can be visually blank

The first native Markdown-to-Code conversion produced an empty editor rectangle: no source text or line number, despite content appearing in Preview and being editable through the accessible editor. The blank editor persisted while switching notes and changing to Editor-only view. After quitting and reopening Notch, the code and line number appeared normally.

This is an initialization/layout observation, not data loss. Quiver displayed its code immediately in the comparison. Investigate Monaco measurement during cell conversion/mount and mode changes; root cause is unconfirmed.

### P1 — Native tutorial import reports success with zero imported notes

File → Import Quiver Library → select `/private/tmp/notch-qa/fixture.qvlibrary` through the native chooser → Open. The completion alert says `Successfully imported 0 notes from 0 notebooks.` The library still has four notes and no tutorial notebook.

The selected fixture contains `Tutorial.qvnotebook`, readable notebook metadata and twelve `.qvnote` packages. The earlier browser/service import of this fixture succeeded. The native failure was observed once; investigate the selected path, filesystem permissions and metadata-reading errors before assigning a root cause. `src/services/import.ts` silently skips notebook metadata read failures, so a zero-result success message can conceal useful diagnostics. Report skipped items and distinguish an empty library from an unreadable/import-failed library.

### P1 — Note deletion and recovery have no usable UI

Right-clicking a Notch note exposes only Copy Note Link. Native File/Edit/View menus do not provide the ordinary note delete/restore workflow; the visible Trash collection does not supply the missing entry action. Quiver's actual Note menu provides Delete Note and Duplicate Note, alongside movement and export actions.

This confirms the earlier UI/source finding. No permanent deletion was executed against the user library. The earlier isolated service tests cover separate notebook-deletion consistency defects.

## P2 — Interaction and layout polish

| Finding | Native evidence and expected improvement |
|---|---|
| Return in title does not enter body | After setting `QA Native Mixed Cells`, Return leaves the caret in the title. Quiver moves focus into the body. Add explicit title-to-editor navigation. |
| Creating a notebook does not select it | Created QA notebook while in All Notes, then Cmd+N created the note in Inbox. Selecting the QA notebook first places subsequent notes correctly. Select the created notebook or make the destination clearer. |
| View and collection reset on restart | Quit with tag `qa-native` selected and Editor-only view. Reopen retains the library and selected note, but resets to All Notes and side-by-side mode. Persist collection/view state. |
| Settings ignores Escape | Open settings and press Escape: dialog remains. Search and in-note find do dismiss with Escape. Make dismissal/focus behavior consistent. |
| Settings overflows horizontally | At the normal 1152×768 window, the model selector reaches beyond the dialog content area and a horizontal scrollbar appears. Refresh control wraps below the selector. |
| Assistant hides editor view controls | Opening the disabled assistant at 1152×768 leaves a narrow split editor, wraps “Markdown Cell,” and clips right-side toolbar/view controls. Provide an adaptive toolbar or change the pane layout. |
| Mermaid connector has poor contrast | Native `flowchart TD` Start → Finish renders with a dark arrow against the dark background. Nodes are visible, connector is difficult to see. |
| Duplicate title in split view | Large editable title is followed by the same large title in Preview, consuming space and giving two competing reading starts. |
| Context menu survives unrelated native actions | Open note context menu, use native File → Export Note, then create a new note. Copy Note Link remains in the page accessibility tree until another editor click. Dismiss transient menus on navigation/native action. |
| Search excerpt hides why the result matched | Searching `answer` finds the code-containing note, but the narrow excerpt starts at the beginning of its Markdown rather than around the code match. In-note find correctly highlights the match in Preview. |
| Image insertion exposes implementation details | Insert Image while editing rich text creates a new Markdown cell containing a UUID-based `notch-resource://` address. Preview renders the image. Quiver has direct rich-text image/attachment controls. Consider inline rich-text insertion. |
| Formatting controls do not adapt well | Bold/list/heading buttons appear for LaTeX/Diagram cells. Source inspection shows the generic non-text toolbar buttons have no click handlers. Hide or disable unsupported controls and expose useful cell-specific actions. |

## Quiver features exposed in the actual native UI

Quiver's Note menu includes Open in New Window, Show Floating Preview, Duplicate Note, Delete Note, Copy As HTML/Markdown/Plain Text/Code Only, and Export As Quiver JSON/HTML/Markdown/Plain Text/PDF/PNG. Its editor exposes arbitrary file attachments and presentation mode. Its File menu includes standalone notebook/note, Markdown, plain-text and Evernote imports.

Notch's native menu exposes library import, note export and library export with a much smaller action set. Several Quiver features need explicit scope decisions; the existence of five cell types does not establish overall equivalence. Merely seeing a Quiver menu item is not proof of its entire downstream flow; exports other than Notch Markdown were inspected, not fully executed in this pass.

## Completed flow coverage

| Flow | Result |
|---|---|
| Open Notch Daily with native chooser | Passed; correct library and original two notes verified |
| Create notebook | Passed; selection behavior above |
| Create nested notebook | Passed; QA Child visibly nested beneath QA parent |
| Cmd+N note creation | Passed; destination depends on selected collection |
| Title update and persistence | Passed via native paste; Return focus gap above |
| Markdown formatted preview | Passed: heading, bold, link and list |
| Cell insertion/conversion | Exercised all five cell types; code focus/layout failures above |
| Code content storage | Passed; export and restart retain exact source |
| LaTeX | `E=mc^2` rendered natively and survived restart |
| Mermaid | Start → Finish rendered and survived restart; contrast issue |
| Native HTML clipboard | Preserved formatting/link but saved unreadable black foreground |
| Native plain-text clipboard | Displayed legibly; line breaks preserved in tested fresh cell |
| Move note to QA notebook | Passed; Inbox and notebook counts updated |
| Favorite and tag creation | Passed; favorite count/tag persisted across restart |
| Tag filtering | Passed; only tagged QA note displayed |
| Global search and Enter navigation | Passed for code-content query `answer` |
| In-note find | Passed: 1 of 1, highlighted code match; Escape closed |
| Editor/Preview/split controls | Worked; layout resets on restart |
| Native Markdown export | Passed, file inspected at `/private/tmp/notch-native-qa-export.md`; all four mixed-cell sources and tag present |
| Native image chooser/insertion | Passed; resource rendered and survived full app restart |
| Settings and disabled assistant | Exercised; dismissal/overflow issues above |
| Native Quiver library import | Failed: zero-result success alert; unchanged count |
| Full quit/reopen | Content/library/selected note persisted; collection and view reset |
| Quiver comparison | Same HTML paste, code visibility, Shift+Return and menu inspection completed |

## Test artifacts and limits

Notch Daily now contains the two synthetic notes `QA Native Mixed Cells` and `QA Native Rich Text`, the notebook `QA Native 2026-09-08`, its empty child `QA Child`, tag `qa-native`, one favorite and one copied tutorial image. These are retained for reproduction. Quiver's QA note contains the comparison samples. No application source was modified during this pass.

This is a broad native UI audit, not a full release sign-off. Offline operation, drag/drop, OS document opening, updater installation, crash recovery, every export format, enabled assistant conversations, and destructive recovery flows were not completed. The prior local assistant/service checks remain separate evidence. The new native findings should be retested in a packaged release after fixes, especially Monaco initialization and filesystem import behavior.
