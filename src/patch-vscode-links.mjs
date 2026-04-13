#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "codex-local-link-patch.template.js");
const SCRIPT_RELATIVE_PATH = path.join("webview", "assets", "codex-local-link-patch.js");
const HTML_RELATIVE_PATH = path.join("webview", "index.html");
const BACKUP_SUFFIX = ".orig";
const SCRIPT_TAG =
  '<script type="module" crossorigin src="./assets/codex-local-link-patch.js"></script>';
const PATCH_MARKER = "Codex VS Code local file link hot patch.";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const extensionDir = await findInstalledExtension();
  const scriptPath = path.join(extensionDir, SCRIPT_RELATIVE_PATH);
  const htmlPath = path.join(extensionDir, HTML_RELATIVE_PATH);
  const scriptBackupPath = `${scriptPath}${BACKUP_SUFFIX}`;
  const htmlBackupPath = `${htmlPath}${BACKUP_SUFFIX}`;
  const patchSource = await fs.readFile(TEMPLATE_PATH, "utf8");
  const state = await inspectTarget({
    scriptPath,
    htmlPath,
    scriptBackupPath,
    htmlBackupPath,
    patchSource,
  });

  if (options.dryRun) {
    printPlan({
      action: options.restore ? "restore" : "patch",
      extensionDir,
      scriptPath,
      htmlPath,
      scriptBackupPath,
      htmlBackupPath,
      state,
    });
    return;
  }

  if (options.restore) {
    await restorePatch({
      scriptPath,
      htmlPath,
      scriptBackupPath,
      htmlBackupPath,
      state,
    });
    console.log(`Extension: ${extensionDir}`);
    console.log(`Restored script: ${scriptPath}`);
    if (state.hasHtmlBackup) {
      console.log(`Restored html: ${htmlPath}`);
    } else {
      console.log("HTML restore: skipped (no backup found).");
    }
    console.log("Next step: run 'Developer: Reload Window' in VS Code.");
    return;
  }

  await applyPatch({
    scriptPath,
    htmlPath,
    scriptBackupPath,
    htmlBackupPath,
    patchSource,
  });

  console.log(`Patched: ${scriptPath}`);
  console.log(`Extension: ${extensionDir}`);
  if (state.shouldUpdateHtml) {
    console.log(`Updated: ${htmlPath}`);
  }
  console.log("Status: local link patch is installed.");
  console.log("Next step: run 'Developer: Reload Window' in VS Code.");
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    restore: false,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--restore") {
      options.restore = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log("Usage: node ./src/patch-vscode-links.mjs [--dry-run] [--restore]");
  console.log("");
  console.log("Options:");
  console.log("  --dry-run   Show what would happen without writing files.");
  console.log("  --restore   Restore from .orig backups when available.");
  console.log("  --help      Show this help message.");
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

async function inspectTarget({
  scriptPath,
  htmlPath,
  scriptBackupPath,
  htmlBackupPath,
  patchSource,
}) {
  const scriptContents = await safeReadFile(scriptPath);
  const htmlContents = await safeReadFile(htmlPath);
  const scriptBackupContents = await safeReadFile(scriptBackupPath);
  const htmlBackupContents = await safeReadFile(htmlBackupPath);

  const scriptStatus =
    scriptContents == null
      ? "missing"
      : scriptContents === patchSource || scriptContents.includes(PATCH_MARKER)
        ? "patched"
        : "custom";

  return {
    scriptStatus,
    hasHtmlTag: htmlContents?.includes(SCRIPT_TAG) ?? false,
    hasScriptBackup: scriptBackupContents != null,
    hasHtmlBackup: htmlBackupContents != null,
    shouldWriteScript: scriptContents !== patchSource,
    shouldUpdateHtml: !(htmlContents?.includes(SCRIPT_TAG) ?? false),
  };
}

async function applyPatch({
  scriptPath,
  htmlPath,
  scriptBackupPath,
  htmlBackupPath,
  patchSource,
}) {
  await ensureParentDirectory(scriptPath);
  await maybeBackupOriginal(scriptPath, scriptBackupPath, patchSource);
  await maybeBackupHtml(htmlPath, htmlBackupPath);
  await fs.writeFile(scriptPath, patchSource, "utf8");
  await ensureScriptIsLoaded(htmlPath);
}

async function restorePatch({
  scriptPath,
  htmlPath,
  scriptBackupPath,
  htmlBackupPath,
  state,
}) {
  if (!state.hasScriptBackup && !state.hasHtmlBackup) {
    throw new Error("No backup files found. Restore is unavailable for this install.");
  }

  if (state.hasScriptBackup) {
    const backupContents = await fs.readFile(scriptBackupPath, "utf8");
    await fs.writeFile(scriptPath, backupContents, "utf8");
  }

  if (state.hasHtmlBackup) {
    const backupContents = await fs.readFile(htmlBackupPath, "utf8");
    await fs.writeFile(htmlPath, backupContents, "utf8");
  }
}

function printPlan({
  action,
  extensionDir,
  scriptPath,
  htmlPath,
  scriptBackupPath,
  htmlBackupPath,
  state,
}) {
  console.log(`Mode: dry-run (${action})`);
  console.log(`Extension: ${extensionDir}`);
  console.log(`Script: ${scriptPath}`);
  console.log(`HTML: ${htmlPath}`);
  console.log(`Script status: ${state.scriptStatus}`);
  console.log(`HTML tag present: ${state.hasHtmlTag ? "yes" : "no"}`);
  console.log(`Script backup: ${state.hasScriptBackup ? scriptBackupPath : "missing"}`);
  console.log(`HTML backup: ${state.hasHtmlBackup ? htmlBackupPath : "missing"}`);

  if (action === "patch") {
    console.log(`Would write script: ${state.shouldWriteScript ? "yes" : "no"}`);
    console.log(`Would update HTML: ${state.shouldUpdateHtml ? "yes" : "no"}`);
    console.log(
      `Would create script backup: ${
        !state.hasScriptBackup && state.scriptStatus === "custom" ? "yes" : "no"
      }`,
    );
    console.log(
      `Would create HTML backup: ${
        !state.hasHtmlBackup && state.shouldUpdateHtml ? "yes" : "no"
      }`,
    );
    return;
  }

  console.log(`Would restore script: ${state.hasScriptBackup ? "yes" : "no"}`);
  console.log(`Would restore HTML: ${state.hasHtmlBackup ? "yes" : "no"}`);
}

async function maybeBackupOriginal(scriptPath, backupPath, patchSource) {
  const existing = await safeReadFile(scriptPath);
  if (existing == null || existing === patchSource || existing.includes(PATCH_MARKER)) {
    return;
  }

  try {
    await fs.access(backupPath);
  } catch {
    await fs.writeFile(backupPath, existing, "utf8");
  }
}

async function maybeBackupHtml(htmlPath, backupPath) {
  const html = await safeReadFile(htmlPath);
  if (html == null || html.includes(SCRIPT_TAG)) {
    return;
  }

  try {
    await fs.access(backupPath);
  } catch {
    await fs.writeFile(backupPath, html, "utf8");
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
