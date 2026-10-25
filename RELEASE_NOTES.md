# Notch 0.4.0

This release brings Emacs and Vim keybindings to Markdown cells, alongside more Quiver-style editing and viewing workflows, faster search for large notes, and navigation and preview improvements. It includes the changes from the unpublished 0.3.2 draft.

## Editing and navigation

- Use Emacs and Vim keybindings in Markdown cells as well as code cells, including word movement, kill/yank, mark selection, and Vim editing modes.
- Edit Markdown with stable syntax highlighting, word wrapping, and undoable toolbar formatting and image insertion. Pasted images retain the original insertion position while they are saved.
- Match editor themes to the system appearance by default, while preserving explicitly selected themes.
- Split cells at the cursor, cut/copy/paste whole cells, and undo or redo structural cell changes.
- Navigate Back and Forward between notes.
- Open notes in independent editable windows, with changes synchronized between windows in the same library. Closing a window or quitting waits for pending edits to save.
- Find text reliably across cell types, scroll matches into view, and wrap through results with Return and Shift+Return. Finding text from preview-only mode opens the editor.
- Customize code themes, tab size, line numbers, whitespace, indentation guides, and soft tabs. Choose Standard, Vim, or Emacs keybindings, loaded locally.
- Keep the surrounding note scrolled to the code caret during keyboard navigation.

## Preview, presentation, and export

- Open floating live previews and optionally synchronize editor and preview scrolling.
- Present a note in a dedicated full-screen view, with Escape to return.
- Export PDF, plain text, and PNG. PNG captures rendered math, diagrams, and images through the native macOS renderer.
- Copy an entire note as HTML source, Markdown, plain text, or code only.
- Preserve paragraphs and code indentation in plain-text output, with readable labels for images.
- Reset floating-preview scroll position when switching notes while preserving it during edits.

## Performance and polish

- Create Markdown and code editors as their cells approach the viewport to reduce work when opening long notes.
- Fetch compact search summaries instead of loading full matching note bodies. Search indexing strips rich-text markup while preserving code and readable text.
- Keep the selected search result visible during keyboard navigation and improve search accessibility.
- Reuse preview rendering and resource reads, and avoid redundant work when no detached editor is open.
- Bound the image-resource cache and evict inactive notes while protecting resources used by editors, previews, and exports.
- Fix light code themes retaining a dark background and improve Find highlights without altering editable content.

In a synthetic search fixture of 50 large notes, result loading dropped from roughly 57 MB of note bodies to about 14 KB of summaries. Median JavaScript excerpt formatting fell from 202 ms to 0.27 ms; more work now happens in SQLite. These are component measurements, not total application latency or a measured speed comparison with Quiver.

## Verification and known limits

134 automated tests pass, along with type checking and the production frontend build. Browser checks covered Markdown Emacs/Vim editing, mode switching, formatting undo, and Find. Delayed image insertion has automated regression coverage; its final browser interaction check was interrupted by approval-service timeouts.

Earlier native QA covered search navigation, Find wrapping and scrolling, detached-window editing and synchronization, save-on-quit, presentation mode, floating previews, PNG and plain-text export, code themes, and Vim/Emacs settings. Detailed evidence is in the round 6 performance and round 7 feature QA reports. The updated Markdown editor still needs native WKWebView clipboard, file-drop, and menu-shortcut verification.

PNG export is macOS-only and limits captures to 24 million logical pixels or 30,000 points in height; larger notes can use PDF. Arbitrary attachments and shared file-based synchronization remain gaps relative to Quiver. Signed-release installation and updater installation were not tested in this round.
