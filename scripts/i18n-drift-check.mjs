#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execSync } from "node:child_process";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current.startsWith("--")) {
      const key = current.slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true";
      args[key] = value;
      if (value !== "true") i += 1;
    }
  }
  return args;
}

function readLocalesFromVuepressConfig(configPath) {
  const content = fs.readFileSync(configPath, "utf8");
  const lastLocalesIndex = content.lastIndexOf("locales:");
  if (lastLocalesIndex === -1) return [];

  const objectStart = content.indexOf("{", lastLocalesIndex);
  if (objectStart === -1) return [];

  let depth = 0;
  let objectEnd = -1;
  for (let i = objectStart; i < content.length; i += 1) {
    const char = content[i];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      objectEnd = i;
      break;
    }
  }

  if (objectEnd === -1) return [];

  const localesBlock = content.slice(objectStart, objectEnd + 1);
  const matches = [...localesBlock.matchAll(/["']\/([a-zA-Z0-9_-]+)\/["']\s*:/g)];
  const locales = [...new Set(matches.map((m) => m[1]).filter((value) => value && value !== "/"))];
  return locales.sort();
}

function runGit(command) {
  return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function refExists(ref) {
  if (!ref) return false;
  try {
    runGit(`git rev-parse --verify --quiet ${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

function resolveBaseRef(requestedBase) {
  const candidates = [
    requestedBase,
    requestedBase?.startsWith("origin/") ? requestedBase.replace(/^origin\//, "") : null,
    "origin/main",
    "main",
    "origin/master",
    "master",
    "HEAD~1",
    "HEAD",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (refExists(candidate)) {
      return candidate;
    }
  }

  return "HEAD";
}

function runGitDiff(baseRef, headRef) {
  const command = `git diff --name-only ${baseRef}...${headRef}`;
  const output = runGit(command);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function isSourceDoc(filePath, localeRoots) {
  if (!filePath.startsWith("docs/")) return false;
  if (!filePath.endsWith(".md")) return false;
  if (filePath.startsWith("docs/.vuepress/")) return false;
  return !localeRoots.some((locale) => filePath.startsWith(`docs/${locale}/`));
}

function toLocalizedPath(sourceFile, locale) {
  const relativePath = sourceFile.slice("docs/".length);
  return `docs/${locale}/${relativePath}`;
}

function buildReport({ changedFiles, locales, repoRoot }) {
  const changedSet = new Set(changedFiles.map(normalizePath));
  const sourceFiles = changedFiles.filter((file) => isSourceDoc(file, locales));

  const impacted = sourceFiles.map((sourceFile) => {
    const localeStatuses = locales.map((locale) => {
      const localizedPath = toLocalizedPath(sourceFile, locale);
      const absoluteLocalizedPath = path.join(repoRoot, localizedPath);
      const exists = fs.existsSync(absoluteLocalizedPath);

      if (!exists) {
        return { locale, path: localizedPath, status: "missing" };
      }

      if (!changedSet.has(localizedPath)) {
        return { locale, path: localizedPath, status: "needs_review" };
      }

      return { locale, path: localizedPath, status: "updated" };
    });

    return { source: sourceFile, locales: localeStatuses };
  });

  const counts = { missing: 0, needs_review: 0, updated: 0 };
  for (const item of impacted) {
    for (const localeInfo of item.locales) {
      counts[localeInfo.status] += 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    changedFiles,
    changedSourceFiles: sourceFiles,
    locales,
    impacted,
    counts,
    hasDrift: counts.missing > 0 || counts.needs_review > 0,
  };
}

function buildMarkdownReport(report) {
  if (report.changedSourceFiles.length === 0) {
    return [
      "## Translation Drift Report",
      "",
      "No source markdown files changed in this diff range.",
    ].join("\n");
  }

  const lines = [
    "## Translation Drift Report",
    "",
    `Detected locales: ${report.locales.map((locale) => `\`${locale}\``).join(", ") || "_none_"}`,
    "",
    `Source files changed: ${report.changedSourceFiles.length}`,
    `- missing: ${report.counts.missing}`,
    `- needs_review: ${report.counts.needs_review}`,
    `- updated: ${report.counts.updated}`,
    "",
  ];

  for (const item of report.impacted) {
    lines.push(`### \`${item.source}\``);
    for (const localeInfo of item.locales) {
      const emoji =
        localeInfo.status === "missing"
          ? "❌"
          : localeInfo.status === "needs_review"
            ? "⚠️"
            : "✅";
      lines.push(`- ${emoji} \`${localeInfo.locale}\`: \`${localeInfo.path}\` (${localeInfo.status})`);
    }
    lines.push("");
  }

  lines.push(
    "> `needs_review` means translation exists but was not updated in the same diff range. Human review still required."
  );

  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const configPath = path.join(repoRoot, "docs/.vuepress/config.js");

  const requestedBaseRef = args.base || "origin/main";
  const headRef = args.head || "HEAD";
  const jsonOut = args["json-out"];
  const markdownOut = args["markdown-out"];
  const failOnMissing = args["fail-on-missing"] === "true";
  const baseRef = resolveBaseRef(requestedBaseRef);

  if (baseRef !== requestedBaseRef) {
    process.stderr.write(
      `[i18n-check] Base ref "${requestedBaseRef}" not found. Falling back to "${baseRef}".\n`
    );
  }

  const locales = readLocalesFromVuepressConfig(configPath);
  const changedFiles = runGitDiff(baseRef, headRef);
  const report = buildReport({ changedFiles, locales, repoRoot });
  const markdown = buildMarkdownReport(report);

  if (jsonOut) {
    fs.writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  if (markdownOut) {
    fs.writeFileSync(markdownOut, `${markdown}\n`, "utf8");
  }

  process.stdout.write(`${markdown}\n`);

  if (failOnMissing && report.counts.missing > 0) {
    process.exit(2);
  }
}

main();
