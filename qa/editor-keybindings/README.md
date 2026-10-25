# Markdown Emacs/Vim regression checks

Run `bun qa/editor-keybindings/serve.ts` and open http://127.0.0.1:1467.
This isolated page uses the real Markdown and code cell components without a
native database. Saved text and selection offsets expose the editing results.
Wait for the editor to finish loading before typing; Vim displays `--NORMAL--`.

Verified in the browser:

- Emacs: `C-a` / `C-e` reach line boundaries, `M-f` / `M-b` move by words,
  `C-k` removes the line's text, and `C-y` restores it.
- Emacs: `C-a`, `C-SPC`, `M-f` select `alpha` (offsets 0–5). Bold selection
  produces `**alpha** beta gamma`; native Undo restores the original text.
- Vim: `gg`, `0`, `w` moves to `beta` (offset 6). `dw` deletes `beta ` and
  `u` restores it. `i`, typing, and Escape return to normal mode without
  blurring the editor. `v`, `w` creates a visual selection.
- Switching Emacs → Vim → Standard preserves the current Markdown text.
- Insert image markup edits at the model selection and participates in Undo.
  This tests insertion only; actual resource storage/paste/drop requires Tauri.
- Find beta highlights `beta` in the Monaco Markdown editor.
- Inspect selection returns the caret offset used by cell splitting.
- Both Emacs word movement and Vim deletion/undo still work when Cell is code.

The normal application checks are `bun test`, `bunx tsc --noEmit`, and
`bun run build:frontend`.

For delayed resource storage, choose `delayed-images`, place the cursor at the
start, click Start image paste, move to the end, then click Finish image save.
`[one.png][two.png]` should appear at the original start in that order, and one
Undo should remove both. The storage-position/order regression is covered by
`fileInsertion.test.ts`; this manual scenario still needs a completed browser
run (the browser approval service timed out during verification).
