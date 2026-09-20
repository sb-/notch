# Notch / Quiver audit — September 4, 2026

**Native follow-up completed September 8:** see [QA-NATIVE-AUDIT.md](QA-NATIVE-AUDIT.md) for the extensive current-source native pass against Notch Daily and direct Quiver comparisons. Historical native limitations below describe the earlier stages, not the final coverage.

Notch starts in development mode, but the current production frontend build produces a blank page. Migration handles ordinary notes, images, and links, while backup completeness, Quiver diagrams, and note deletion/recovery need work before claiming Quiver equivalence.

## Scope and evidence

- Launched the checkout with `bun run dev`; Rust compiled and `target/debug/notch` started successfully. Left this development process running.
- Native desktop UI control was initially disabled. It now works; see the native follow-up below. The full native comparison remains incomplete.
- Exercised the actual compiled Notch frontend in the browser with a test-only Tauri transport replacement backed by real SQLite. Test data lives under `/private/tmp/notch-qa`, separate from user libraries. This validates frontend interactions and application queries, **not** Tauri IPC, WebKit-specific behavior, native menus, file pickers, clipboard permissions, or OS document opening.
- The test copy's HTML entry reference was corrected solely to unblock browser testing. Application source was not changed. A test-only button invoked the existing import menu handler; the file picker boundary returned a copied Quiver tutorial fixture.
- Compared against the 12-note tutorial shipped in `/Applications/Quiver.app/Contents/Resources/Tutorial.qvnotebook`, including its real diagram syntax, images, and internal links. This is a documented baseline, not a claim to have tested every feature of the installed Quiver version.
- Existing uncommitted work was preserved. Another editor change was committed during the audit (`ffdc9f0`); the browser used the initial compiled snapshot. Findings below remain supported by the inspected source, and the production-entry failure was reproduced again after that commit.

## Priority findings

### 1. Release blocker: production HTML loads the wrong JavaScript entry

**Reproduced twice; observed blank browser window.**

Build using the same flags as `build:frontend`:

```sh
bun build src/index.html --outdir /private/tmp/notch-qa/release-check --production --splitting
```

Generated `index.html` references `index-xmgcmr5e.js`, which is an AI-provider chunk and does not mount React. The second build lists `index-pbgpeb0e.js` as the JavaScript entry point; that file contains the `createRoot(...).render(...)` call. The first build similarly referenced the provider chunk instead of its app entry (`index-2arrh0cd.js`). Serving the untouched output yielded an empty page without a useful error. Correcting only the reference in the test copy made the app render.

**Impact:** a successful frontend build/type check does not imply a usable release. Fix the build output and add a production-launch smoke check before packaging. Root cause inside Bun's HTML/splitting behavior is not yet isolated. Evidence: [generated HTML](/private/tmp/notch-qa/release-check/index.html), [build log](/private/tmp/notch-qa/build.log), [build configuration](/Users/samb/dev/notch/package.json:11).

### 2. High: JSON library backups are incomplete and have no restore flow

**Reproduced through application services with real SQLite.**

Create a note containing an image resource, export the library, and inspect the JSON: the cell retains a `notch-resource://...` identifier, but the image bytes are absent. Trashed notes are also omitted because the exporter calls `getNotesByNotebook`, which filters out `is_trashed = 1`. The UI import action accepts Quiver libraries; no corresponding Notch JSON restore action exists.

**Impact:** the exported JSON cannot serve as a complete recoverable backup. Include resources, define whether trash belongs in the backup, and implement/test restoration. This finding concerns JSON exports, not copying the original `.notch` package. [Exporter](/Users/samb/dev/notch/src/services/export.ts:271), [query](/Users/samb/dev/notch/src/services/database.ts:373), [import UI](/Users/samb/dev/notch/src/App.tsx:310).

### 3. High: imported Quiver diagrams do not render

**Reproduced in the browser using Quiver's actual tutorial.**

Import the tutorial and open “2 - Cell Types” in Preview. Both sequence and flowchart examples show `Invalid diagram`. Quiver's examples use js-sequence-diagrams (`Title: ...`, `A->B`) and flowchart.js (`st=>start`, `st->op1->cond`); Notch imports the source unchanged and feeds it to Mermaid. A new Mermaid `flowchart TD` diagram renders correctly, so this is a compatibility gap.

Mermaid also leaves error documents outside the note root. Four `Syntax error in text / mermaid version 10.9.5` documents remained in the accessibility tree after navigating to unrelated notes.

Support the original formats or perform an explicit migration with actionable warnings; clean up failed render output. [Diagram editor](/Users/samb/dev/notch/src/components/Editor/cells/DiagramCell.tsx:45), [preview renderer](/Users/samb/dev/notch/src/components/Preview/NotePreview.tsx:107).

### 4. High: Trash is visible, but note delete/restore actions are missing

**Confirmed by UI inspection and call-site search.**

Right-clicking a note exposes only “Copy Note Link.” There is no note deletion or restore control in the editor, note list, keyboard handlers, or native menu definitions. Store/database implementations exist but have no user-facing callers. Therefore a user cannot complete the ordinary trash-and-restore workflow. The underlying database operations passed the isolated persistence test.

Add delete and restore actions, appropriate selection behavior, and recovery controls. [Note context menu](/Users/samb/dev/notch/src/components/NoteList/NoteListItem.tsx:68), [store operations](/Users/samb/dev/notch/src/store/index.ts:208).

### 5. High: deleting a notebook leaves deleted content in application state

**Reproduced through the actual store with real SQLite.**

Create a parent notebook, child notebook, and child note; load the store and delete the parent. The database recursively removes the child and note, but the store removes only the parent notebook. Deleted notes and descendants remain in memory, so counts, selection, and note lists can show content that no longer exists on disk.

The database operation permanently deletes notes rather than moving them to Trash. The confirmation says “Delete this notebook and all its notes?” without stating permanence.

Remove the entire affected subtree and its notes from state, select a valid survivor, and define recovery behavior. [Store deletion](/Users/samb/dev/notch/src/store/index.ts:180), [database deletion](/Users/samb/dev/notch/src/services/database.ts:338), [confirmation](/Users/samb/dev/notch/src/components/Sidebar/Sidebar.tsx:326).

### 6. High: deleting a notebook containing trashed notes fails

**Reproduced with SQLite foreign keys enabled, matching SQLx's default. Native IPC execution still needs verification.**

Create a notebook and note, trash the note, then delete the notebook through the service. `getNotesByNotebook` omits trashed notes, leaving their foreign-key references intact. Deleting the notebook then raises `SQLITE_CONSTRAINT_FOREIGNKEY`. If active notes were present, they could already have been permanently removed before the failure because this operation is not transactional.

Include all affected notes and wrap the operation in an appropriate transaction. [Deletion](/Users/samb/dev/notch/src/services/database.ts:338), [filtered query](/Users/samb/dev/notch/src/services/database.ts:373).

### 7. Medium: code-cell insertion does not move the typing cursor

**Reproduced in the browser.**

Focus a code cell, type `const answer = 42;`, and press Shift+Enter. A new code cell appears, but the old Monaco editor remains focused. The toolbar/store can target the new cell while typing still reaches the old one. `CodeCell` declares `isFocused` but does not consume it or focus the editor when it changes. [CodeCell](/Users/samb/dev/notch/src/components/Editor/cells/CodeCell.tsx:21).

### 8. Medium: layout and reading position reset on reopening

**Reproduced by reloading the browser app.**

Select a tag, choose Editor mode, and switch to single-pane layout with Cmd+1. Reloading returns to All Notes, triple-pane layout, and side-by-side preview. The note contents and tags persist, but these navigation/view preferences do not. [Store defaults and setters](/Users/samb/dev/notch/src/store/index.ts:23), [load selection](/Users/samb/dev/notch/src/store/index.ts:432).

## Other polish and equivalence gaps

- At the tested 934 px viewport, the rich-text toolbar overflows the editor area and clips the right-hand view controls. This width is above the native app's configured 800 px minimum. “Diagram Cell” wraps onto two lines while unrelated formatting controls remain visible.
- Preview repeats the note title underneath the still-visible editable title. Mermaid's default dark connector is difficult to see against Notch's dark background.
- Settings opens without moving focus into the dialog, and Escape does not close it. Only assistant settings are implemented. Quiver's tutorial describes configurable editor behavior, themes, and CSS that have no equivalent controls here.
- Note-list sorting always displays a downward arrow, even though selecting the same sort field can toggle its direction. The title comparator also uses a different sign convention from date sorting. Source-reviewed; reverse-order UI case still needs a focused check.
- Code cells use Monaco's default external CDN loader; the installed `monaco-editor` dependency is not supplied to the loader. Offline first launch of a code cell needs testing and likely local bundling. Online loading worked in this audit; an offline failure was not simulated.
- Standalone note/notebook import, a usable Quiver export UI, arbitrary file attachment insertion, cell merging, presentation windows, automatic backup/recovery, and Quiver's documented sync/collaboration behavior were not established as equivalent. Several are absent from the inspected controls. These need explicit product-scope decisions rather than assuming parity from the five cell types.

## Coverage achieved

| Flow | Result and scope |
|---|---|
| Development launch | Rust build completed; Notch executable started |
| Production build | Command succeeds; output entry reference is wrong; blank UI reproduced twice |
| Existing automated tests | 80 passed, 0 failed |
| TypeScript checking | Passed |
| Notebook/note creation and title edits | Passed in browser QA |
| Rich text, URL paste, Markdown live preview | Passed in browser QA |
| Code editing and cell conversion | Passed; code-cell focus defect above |
| LaTeX and new Mermaid diagram rendering | Passed, visually checked |
| Note content persistence after reopen | Passed against isolated SQLite |
| Favorites and tag creation/filtering | Passed in browser QA |
| Global search, Enter navigation, in-note find count | Passed for the tested text query |
| Editor/preview/split and single-pane switching | Worked; choices reset on reload |
| Quiver tutorial import | 12 notes imported; real images loaded; rewritten internal links navigated correctly |
| Imported Quiver diagrams | Both supplied examples failed |
| Cell order, tags, favorites, search, trash/restore | Core service integration scenario passed |
| Backup/resource/trash completeness and notebook deletion | Four targeted integration scenarios failed as described above |
| Assistant text streaming | Passed against local `gemma3:4b`, 7 incremental updates, correct synthetic-note answer |
| Assistant tool loop | Passed against local `gemma4:e4b`, tool executed and final answer used its result |

The assistant checks use the existing `assistant:e2e` script and synthetic content; they do not cover the full assistant panel, every note tool, cancellation, or cloud providers.

## Remaining native testing

### Native follow-up, September 7–8

- Quiver: created QA notebook `QA Compare 2026-09-07` and note `QA Mixed Cells`. Typed a paragraph and verified Shift+Return inserts and focuses a second text cell. Native menus expose standalone note/notebook, Markdown, plain-text and Evernote imports; PDF/PNG exports; attachment insertion and presentation controls.
- The project folder binary at `src-tauri/target/release/bundle/macos/Notch.app` identifies itself as **0.1.1** in its update prompt. These results must be kept separate from current-source results.
- Opened the user-designated `/Users/samb/dev/notch_libraries/Notch Daily.notch` through the folder binary's native file chooser. Verified the library selector and the two existing notes match the supplied screenshot. Existing notes were not edited.
- Automatic approval review blocked selecting the temporary current-source QA app because it could display another private library. No workaround was attempted. Testing the latest source build against Notch Daily remains outstanding.

The audit is **not a full native end-to-end sign-off**. Still required: actual Quiver interactions, macOS menus and shortcuts, library create/open/rename and switching through file pickers, save/export destinations, OS package opening, native clipboard and drag/drop, offline operation, updater installation, window management, and crash/restart durability. Browser tests substitute the native boundary and cannot establish these.

No application fixes were made. Reproduction harness and tests are retained at [QA server](/private/tmp/notch-qa/server.ts) and [persistence reproductions](/private/tmp/notch-qa/persistence.test.ts). The latter intentionally fails four assertions against the current implementation; it is outside the repository's normal test suite. Start fixes with the production entry, backup completeness/restore, and notebook deletion consistency.
