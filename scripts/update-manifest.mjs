#!/usr/bin/env node
// Checks the real upstream GitHub releases listed in bundled/sources.json and
// updates bundled/manifest.json (version/fileName/downloadUrl) to match.
// Never touches name/description/category/instructions/large/group — those
// are editorial fields, not derived from upstream.
//
// Intentionally tolerant: a problem with one source repo (rate limit,
// network hiccup, no matching asset) is logged and skipped, never a hard
// failure that blocks every other source from updating.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SOURCES_PATH = path.join(ROOT, "bundled", "sources.json");
const MANIFEST_PATH = path.join(ROOT, "bundled", "manifest.json");

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

async function ghFetch(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "gmach-update-manifest-script",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`${url} -> HTTP ${res.status} ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

async function pickRelease(repo, includePrerelease) {
  const releases = await ghFetch(
    `https://api.github.com/repos/${repo}/releases?per_page=20`
  );
  return releases.find((r) => !r.draft && (includePrerelease || !r.prerelease)) || null;
}

async function main() {
  const sourcesConfig = JSON.parse(await readFile(SOURCES_PATH, "utf8"));
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const itemsById = new Map(manifest.items.map((it) => [it.id, it]));

  let changed = false;
  const changeLog = [];
  const problems = [];

  for (const source of sourcesConfig.sources) {
    let release;
    try {
      release = await pickRelease(source.repo, !!source.includePrerelease);
    } catch (err) {
      problems.push(`${source.repo}: failed to fetch releases — ${err.message}`);
      continue;
    }
    if (!release) {
      problems.push(`${source.repo}: no suitable (non-draft) release found`);
      continue;
    }

    for (const entry of source.items) {
      const item = itemsById.get(entry.id);
      if (!item) {
        problems.push(
          `${source.repo}: manifest has no item with id "${entry.id}" — add the base entry manually once (name/description/category/instructions), the script only updates version/fileName/downloadUrl`
        );
        continue;
      }

      const re = new RegExp(entry.assetPattern);
      const asset = release.assets.find((a) => re.test(a.name));
      if (!asset) {
        problems.push(
          `${source.repo}@${release.tag_name}: no asset matched /${entry.assetPattern}/ for "${entry.id}" (available: ${release.assets.map((a) => a.name).join(", ") || "none"})`
        );
        continue;
      }

      const next = {
        version: release.tag_name,
        fileName: asset.name,
        downloadUrl: asset.browser_download_url,
      };
      const prev = {
        version: item.version,
        fileName: item.fileName,
        downloadUrl: item.downloadUrl,
      };
      if (JSON.stringify(next) !== JSON.stringify(prev)) {
        changeLog.push(
          `${entry.id}: ${prev.version} -> ${next.version} (${prev.fileName} -> ${next.fileName})`
        );
        item.version = next.version;
        item.fileName = next.fileName;
        item.downloadUrl = next.downloadUrl;
        changed = true;
      }
    }
  }

  if (problems.length) {
    console.log("Problems encountered (non-fatal, skipped):");
    for (const p of problems) console.log("  - " + p);
  }

  if (!changed) {
    console.log("No version changes — manifest.json left untouched.");
    return;
  }

  console.log("Updated:");
  for (const line of changeLog) console.log("  - " + line);

  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  // Signal to the workflow (via a marker file) that a commit is needed —
  // simpler and more robust than parsing this script's stdout in bash.
  await writeFile(path.join(ROOT, ".manifest-changed"), changeLog.join("\n") + "\n", "utf8");
}

main().catch((err) => {
  console.error("update-manifest.mjs failed:", err);
  process.exitCode = 1;
});
