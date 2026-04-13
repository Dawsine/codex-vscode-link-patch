// Codex VS Code local file link hot patch.
// Reapply this file after each extension update.

import { n as fetchFromVSCode } from "./vscode-api-Bi7RdfNd.js";
import { n as messageBus } from "./message-bus-7kGnFY_-.js";

const FILE_EXTENSION_PATTERN = /\.[A-Za-z0-9][A-Za-z0-9_-]{0,31}(?:[#?].*)?$/;
const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WINDOWS_ABSOLUTE_PATTERN = /^(?:\/)?[A-Za-z]:[\\/]/;
const KNOWN_BARE_FILE_NAMES = new Set([
  "dockerfile",
  "makefile",
  "justfile",
  "procfile",
  "readme",
  "license",
  "copying",
  "changelog",
]);

function hasFileLikeSuffix(value) {
  return FILE_EXTENSION_PATTERN.test(value);
}

function isLikelyBareFileName(value) {
  const candidate = value.split(/[\\/]/).pop() ?? value;
  if (!candidate || candidate === "." || candidate === "..") {
    return false;
  }

  if (/^\.[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(candidate)) {
    return true;
  }

  if (hasFileLikeSuffix(candidate)) {
    return true;
  }

  return (
    KNOWN_BARE_FILE_NAMES.has(candidate) ||
    KNOWN_BARE_FILE_NAMES.has(candidate.toLowerCase())
  );
}

function isLocalFileHref(href) {
  if (!href || href.startsWith("#")) {
    return false;
  }

  const candidatePath = stripQuery(parsePathAndLocation(href).path);

  if (/^file:\/\//i.test(href) || /^vscode:\/\/file\//i.test(href)) {
    return true;
  }

  if (WINDOWS_ABSOLUTE_PATTERN.test(candidatePath)) {
    return true;
  }

  if (candidatePath.startsWith("/")) {
    return hasFileLikeSuffix(candidatePath) || isLikelyBareFileName(candidatePath);
  }

  if (SCHEME_PATTERN.test(candidatePath)) {
    return false;
  }

  if (/[\\/]/.test(candidatePath)) {
    return hasFileLikeSuffix(candidatePath) || isLikelyBareFileName(candidatePath);
  }

  return isLikelyBareFileName(candidatePath);
}

function decodePath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripQuery(value) {
  const queryIndex = value.indexOf("?");
  return queryIndex === -1 ? value : value.slice(0, queryIndex);
}

function parseLineFragment(fragment) {
  const match = /^L(\d+)(?:C(\d+))?/i.exec(fragment ?? "");
  if (!match) {
    return {};
  }

  return {
    line: Math.max(1, Number.parseInt(match[1], 10)),
    column: match[2] ? Math.max(1, Number.parseInt(match[2], 10)) : 1,
  };
}

function parsePathAndLocation(rawHref) {
  if (/^file:\/\//i.test(rawHref)) {
    const url = new URL(rawHref);
    let path = decodePath(url.pathname);
    if (WINDOWS_ABSOLUTE_PATTERN.test(path)) {
      path = path.slice(1);
    }
    return {
      path,
      ...parseLineFragment(url.hash.replace(/^#/, "")),
    };
  }

  if (/^vscode:\/\/file\//i.test(rawHref)) {
    const url = new URL(rawHref);
    const match = url.pathname.match(/^(.*?)(?::(\d+))(?::(\d+))?$/);
    let path = decodePath(match ? match[1] : url.pathname);
    if (WINDOWS_ABSOLUTE_PATTERN.test(path)) {
      path = path.slice(1);
    }
    return {
      path,
      line: match ? Math.max(1, Number.parseInt(match[2], 10)) : undefined,
      column: match?.[3] ? Math.max(1, Number.parseInt(match[3], 10)) : undefined,
    };
  }

  const hashIndex = rawHref.indexOf("#");
  const pathWithQuery = hashIndex === -1 ? rawHref : rawHref.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : rawHref.slice(hashIndex + 1);
  let path = decodePath(stripQuery(pathWithQuery));

  const fragmentLocation = parseLineFragment(fragment);
  if (fragmentLocation.line != null) {
    return {
      path,
      ...fragmentLocation,
    };
  }

  const colonLocation = path.match(/^(.*?)(?::(\d+)(?::(\d+))?)$/);
  if (colonLocation && colonLocation[1]) {
    path = colonLocation[1];
    return {
      path,
      line: Math.max(1, Number.parseInt(colonLocation[2], 10)),
      column: colonLocation[3]
        ? Math.max(1, Number.parseInt(colonLocation[3], 10))
        : 1,
    };
  }

  return { path };
}

function asPositiveInteger(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return parsed > 0 ? parsed : undefined;
  }

  return undefined;
}

function normalizeReference(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  if (typeof input.path === "string" && input.path.length > 0) {
    return {
      path: input.path,
      line: asPositiveInteger(input.line),
      column: asPositiveInteger(input.column),
      cwd: typeof input.cwd === "string" ? input.cwd : null,
    };
  }

  if (
    input.reference &&
    typeof input.reference === "object" &&
    typeof input.reference.path === "string" &&
    input.reference.path.length > 0
  ) {
    return {
      path: input.reference.path,
      line: asPositiveInteger(input.reference.line ?? input.line),
      column: asPositiveInteger(input.reference.column ?? input.column),
      cwd: typeof input.cwd === "string" ? input.cwd : null,
    };
  }

  if (typeof input.href === "string" && isLocalFileHref(input.href)) {
    return {
      ...parsePathAndLocation(input.href),
      cwd: typeof input.cwd === "string" ? input.cwd : null,
    };
  }

  return null;
}

function getReactInternalValue(node, prefix) {
  if (!node || typeof node !== "object") {
    return null;
  }

  for (const key of Object.getOwnPropertyNames(node)) {
    if (key.startsWith(prefix)) {
      return node[key];
    }
  }

  return null;
}

function extractReferenceFromReactTree(startNode) {
  const visitedFibers = new Set();

  for (
    let node = startNode;
    node && typeof node.closest === "function";
    node = node.parentElement
  ) {
    const directProps = normalizeReference(getReactInternalValue(node, "__reactProps$"));
    if (directProps) {
      return directProps;
    }

    let fiber = getReactInternalValue(node, "__reactFiber$");
    while (fiber && !visitedFibers.has(fiber)) {
      visitedFibers.add(fiber);

      const memoizedProps = normalizeReference(fiber.memoizedProps);
      if (memoizedProps) {
        return memoizedProps;
      }

      const pendingProps = normalizeReference(fiber.pendingProps);
      if (pendingProps) {
        return pendingProps;
      }

      fiber = fiber.return;
    }
  }

  return null;
}

function looksLikeFileLinkButton(button) {
  const className =
    typeof button?.className === "string"
      ? button.className
      : String(button?.className ?? "");
  return (
    className.includes("appearance-none") &&
    className.includes("bg-transparent") &&
    className.includes("text-left")
  );
}

function openLocalReference(reference, fallbackUrl) {
  void fetchFromVSCode("open-file", {
    params: {
      path: reference.path,
      line: reference.line,
      column: reference.line == null ? undefined : (reference.column ?? 1),
      cwd: reference.cwd ?? null,
    },
  }).catch(() => {
    messageBus.dispatchMessage("open-in-browser", {
      url: fallbackUrl ?? reference.path,
    });
  });
}

document.addEventListener(
  "click",
  (event) => {
    const target = event.target;
    const anchor =
      target && typeof target.closest === "function"
        ? target.closest("a[href]")
        : null;
    const href = anchor?.getAttribute("href") || "";

    if (!anchor || !isLocalFileHref(href)) {
      const button =
        target && typeof target.closest === "function"
          ? target.closest("button")
          : null;
      if (!button || !looksLikeFileLinkButton(button)) {
        return;
      }

      const reference = extractReferenceFromReactTree(button);
      if (!reference?.path) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openLocalReference(reference, reference.path);
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    openLocalReference(
      {
        ...parsePathAndLocation(href),
        cwd: null,
      },
      href,
    );
  },
  true,
);
