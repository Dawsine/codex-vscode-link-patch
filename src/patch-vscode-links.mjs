#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "codex-local-link-patch.template.js");
const SCRIPT_RELATIVE_PATH = path.join("webview", "assets", "codex-local-link-patch.js");
const HTML_RELATIVE_PATH = path.join("webview", "index.html");
const SCRIPT_TAG =
  '<script type="module" crossorigin src="./assets/codex-local-link-patch.js"></script>';
const PATCH_MARKER = "Codex VS Code local file link hot patch.";

async function main() {
  const extensionDir = await findInstalledExtension();
  const scriptPath = path.join(extensionDir, SCRIPT_RELATIVE_PATH);
  const htmlPath = path.join(extensionDir, HTML_RELATIVE_PATH);
  const patchSource = await fs.readFile(TEMPLATE_PATH, "utf8");

  await ensureParentDirectory(scriptPath);
  await maybeBackupOriginal(scriptPath, patchSource);
  await fs.writeFile(scriptPath, patchSource, "utf8");

  const htmlWasUpdated = await ensureScriptIsLoaded(htmlPath);
  const alreadyPatched = (await safeReadFile(scriptPath))?.includes(PATCH_MARKER) ?? false;

  console.log(`Patched: ${scriptPath}`);
  console.log(`Extension: ${extensionDir}`);
  if (htmlWasUpdated) {
    console.log(`Updated: ${htmlPath}`);
  }
  if (alreadyPatched) {
    console.log("Status: local link patch is installed.");
  }
  console.log("Next step: run 'Developer: Reload Window' in VS Code.");
}

async function findInstalledExtension() {
  const roots = [
    process.env.CODEX_VSCODE_EXTENSIONS_DIR,
    path.join(os.homedir(), ".vscode", "extensions"),
  ].filter(Boolean);

  const matches = [];
  for (const root of roots) {
    const entries = await safeReadDir(root);
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (!entry.name.startsWith("openai.chatgpt-")) {
        continue;
      }

      const candidate = path.join(root, entry.name);
      if (await isValidExtensionDir(candidate)) {
        const stat = await fs.stat(candidate);
        matches.push({
          dir: candidate,
          mtimeMs: stat.mtimeMs,
        });
      }
    }
  }

  matches.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const latest = matches[0]?.dir;
  if (!latest) {
    throw new Error("Could not find an installed openai.chatgpt-* VS Code extension.");
  }
  return latest;
}

async function isValidExtensionDir(dir) {
  const htmlPath = path.join(dir, HTML_RELATIVE_PATH);
  try {
    const stat = await fs.stat(htmlPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function maybeBackupOriginal(scriptPath, patchSource) {
  const existing = await safeReadFile(scriptPath);
  if (existing == null || existing === patchSource || existing.includes(PATCH_MARKER)) {
    return;
  }

  const backupPath = `${scriptPath}.orig`;
  try {
    await fs.access(backupPath);
  } catch {
    await fs.writeFile(backupPath, existing, "utf8");
  }
}

async function ensureScriptIsLoaded(htmlPath) {
  const html = await fs.readFile(htmlPath, "utf8");
  if (html.includes(SCRIPT_TAG)) {
    return false;
  }

  let updatedHtml = html;
  if (html.includes("</head>")) {
    updatedHtml = html.replace("</head>", `    ${SCRIPT_TAG}\n  </head>`);
  } else if (html.includes("</body>")) {
    updatedHtml = html.replace("</body>", `    ${SCRIPT_TAG}\n  </body>`);
  } else {
    updatedHtml = `${html}\n${SCRIPT_TAG}\n`;
  }

  await fs.writeFile(htmlPath, updatedHtml, "utf8");
  return true;
}

async function ensureParentDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function safeReadFile(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function safeReadDir(dirPath) {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

await main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`patch failed: ${message}`);
  process.exitCode = 1;
});
