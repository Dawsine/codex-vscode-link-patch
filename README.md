# codex-vscode-link-patch

Hot patch utility for the VS Code Codex/OpenAI ChatGPT extension when local file links in chat stop opening in the editor.

## What It Does

This tool patches the installed `openai.chatgpt-*` VS Code extension by replacing `webview/assets/codex-local-link-patch.js` with a more aggressive local-file handler.

The patch currently improves two cases:

- Markdown links such as `package.json`, `Dockerfile`, `.env`, relative paths, absolute paths, and `file://` links.
- Blue file-link buttons rendered by the Codex webview that do not use a normal `<a>` tag.

## Usage

Run the patcher:

```bash
npm install
npm run patch
```

Or run the script directly:

```bash
node ./src/patch-vscode-links.mjs
```

Preview what the tool would do without writing files:

```bash
npm run patch:dry-run
```

Restore from backups if they exist:

```bash
npm run restore
```

Preview a restore without changing files:

```bash
npm run restore:dry-run
```

After patching, reload the VS Code window:

```text
Developer: Reload Window
```

## Notes

- The patch targets the newest installed `openai.chatgpt-*` extension under `~/.vscode/extensions/`.
- If the extension updates, re-run the patch.
- The patcher keeps one-time backups at `codex-local-link-patch.js.orig` and, when needed, `index.html.orig`.
- `restore` only works when a backup exists for the current extension install.

## Project Layout

```text
codex-vscode-link-patch/
  README.md
  requirements.txt
  .gitignore
  package.json
  src/
    patch-vscode-links.mjs
    codex-local-link-patch.template.js
  notes/
  experiments/
```
