# Notch 0.3.0

This release improves native editing, data recovery, and compatibility with imported Quiver notes.

## Editing and navigation

- Fix code cells appearing blank until the window is resized. Monaco now initializes at the correct size and draws without waiting for background animation frames.
- Fix new-cell focus with Shift+Return, title-to-body navigation with Return, and multiline code-cell sizing.
- Keep pasted rich text legible in dark mode and insert images directly at the rich-text caret.
- Make Markdown formatting controls work and hide unsupported formatting actions for math and diagram cells.
- Preserve library-specific view, collection, and note selection across restarts. Select notes in the displayed sort order and select newly created notebooks immediately.
- Show and highlight matching text in search excerpts, including matches in later code cells.

## Import, backup, and recovery

- Fix native Quiver library imports that could report success with zero imported notes. Read the selected package recursively and report failed items clearly.
- Render supported legacy Quiver sequence diagrams and flowcharts while preserving their original source. Improve diagram contrast and clean up rendering errors.
- Add native and context-menu actions to duplicate notes, move them to Trash, and restore them. Duplicated notes retain independent image resources.
- Preserve notes, tags, and resources when deleting a notebook subtree by moving its notes to Trash, including notes already trashed.
- Export complete version 2 library backups, including Trash and resource bytes, and restore them atomically into a new empty library. Invalid or incomplete older backups are rejected with an explanation.

## Polish and packaging

- Fix Settings overflow, Escape dismissal, and focus handling.
- Keep editor controls accessible alongside the assistant; adapt narrow split panes and dismiss transient menus consistently.
- Remove the repeated title in split preview.
- Fix the production application entry and bundle Monaco locally, avoiding its CDN dependency.

## Verification and known limits

111 automated tests pass, including SQLite recovery and backup round trips. Native macOS testing verified code editing and Undo/Redo, note duplication and recovery, inline images, settings, responsive layout, search, all 12 Quiver tutorial imports, and a backup restoration of 18 notes with 17 byte-identical resources.

This release does not provide complete Quiver feature parity. Floating previews, presentation mode, arbitrary attachments, additional export formats such as PDF/PNG, and shared file-based synchronization remain separate work. Complex legacy diagram syntax outside the supported subset displays an explanatory error. Signed-release installation, updater installation, and enabled assistant conversations were not part of the native fix verification.
