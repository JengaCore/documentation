/**
 * Test suite for i18n-drift-check.mjs. Run with `npm test`.
 *
 * Uses Node's built-in runner, so there is nothing to install.
 *
 * Two layers:
 *   - unit tests import the pure helpers directly;
 *   - integration tests build a throwaway git repository in a temp directory and run the
 *     CLI against it, because the interesting behaviour lives in what git reports and what
 *     the script concludes from it. Mocking git here would test the mock.
 *
 * ---------------------------------------------------------------------------------------
 * VERSION FRANÇAISE
 *
 * Suite de tests de i18n-drift-check.mjs. À lancer avec `npm test`.
 *
 * Utilise le lanceur intégré de Node, il n'y a donc rien à installer.
 *
 * Deux couches :
 *   - les tests unitaires importent directement les fonctions pures ;
 *   - les tests d'intégration construisent un dépôt git jetable dans un dossier temporaire et
 *     y lancent le CLI, parce que le comportement intéressant réside dans ce que git rapporte
 *     et ce que le script en conclut. Simuler git ici, ce serait tester la simulation.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  parseArgs,
  gitBlobSha,
  readSourceStamp,
  writeSourceStamp,
  isSourceDoc,
  toLocalizedPath,
  toSourcePath,
  resolveFailOn,
} from "./i18n-drift-check.mjs";

const SCRIPT = fileURLToPath(new URL("./i18n-drift-check.mjs", import.meta.url));

/* --------------------------------------------------- helpers / utilitaires */

function write(root, relativePath, content) {
  const absolute = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, "utf8");
  return absolute;
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function commit(cwd, message) {
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "-m", `test(fixture): ${message}`]);
}

/**
 * Runs the CLI the way CI does, and returns what a caller could actually observe.
 *
 * FR : lance le CLI comme le fait la CI, et renvoie ce qu'un appelant peut réellement
 * observer — code de sortie, sortie standard, sortie d'erreur.
 */
function run(cwd, args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
  return { code: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function makeRepo(t, { locales = ["fr"], pages = {}, branch = "master" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-drift-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const declared = ["'/': {}", ...locales.map((locale) => `'/${locale}/': {}`)].join(", ");
  write(root, "docs/.vuepress/config.js", `module.exports = { locales: { ${declared} } };\n`);
  for (const [relativePath, content] of Object.entries(pages)) write(root, relativePath, content);

  git(root, ["init", "-q", "-b", branch]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "test"]);
  commit(root, "initial docs tree");
  return root;
}

const SOURCE_PAGE = "# Guide\n\nDeployment takes three steps.\n";
const TRANSLATED_PAGE = "# Guide\n\nLe deploiement se fait en trois etapes.\n";

/* ------------------------------- unit: hash / unitaire : l'empreinte ------ */

test("gitBlobSha reproduces `git hash-object` exactly", (t) => {
  const root = makeRepo(t, { pages: { "docs/technical/guide.md": SOURCE_PAGE } });
  const target = path.join(root, "docs/technical/guide.md");

  const fromGit = git(root, ["hash-object", "docs/technical/guide.md"]).trim();
  assert.equal(gitBlobSha(target), fromGit);
});

test("gitBlobSha changes when a single character changes", (t) => {
  const root = makeRepo(t, { pages: { "docs/a.md": "one\n" } });
  const target = path.join(root, "docs/a.md");
  const before = gitBlobSha(target);

  fs.writeFileSync(target, "one,\n", "utf8");
  assert.notEqual(gitBlobSha(target), before);
});

/* ------------- unit: stamp files / unitaire : écriture des empreintes ----- */

test("writeSourceStamp creates front matter when the page has none", (t) => {
  const root = makeRepo(t, { pages: { "docs/fr/a.md": "# Titre\n\nTexte.\n" } });
  const target = path.join(root, "docs/fr/a.md");

  assert.equal(writeSourceStamp(target, "abc123"), "created");
  assert.equal(readSourceStamp(target), "abc123");
  // The original body must survive untouched.
  // FR : le corps d'origine doit survivre intact.
  assert.match(fs.readFileSync(target, "utf8"), /# Titre\n\nTexte\.\n$/);
});

test("writeSourceStamp keeps every existing front-matter key", (t) => {
  const root = makeRepo(t, {
    pages: { "docs/fr/a.md": "---\ntitle: Notes\nsidebar: auto\n---\n\n# Notes\n" },
  });
  const target = path.join(root, "docs/fr/a.md");

  assert.equal(writeSourceStamp(target, "deadbeef"), "stamped");

  const content = fs.readFileSync(target, "utf8");
  assert.match(content, /title: Notes/);
  assert.match(content, /sidebar: auto/);
  assert.equal(readSourceStamp(target), "deadbeef");
});

test("writeSourceStamp is idempotent and reports it", (t) => {
  const root = makeRepo(t, { pages: { "docs/fr/a.md": "# A\n" } });
  const target = path.join(root, "docs/fr/a.md");

  writeSourceStamp(target, "abc123");
  const snapshot = fs.readFileSync(target, "utf8");

  assert.equal(writeSourceStamp(target, "abc123"), "unchanged");
  assert.equal(fs.readFileSync(target, "utf8"), snapshot);
});

test("writeSourceStamp replaces an outdated stamp rather than appending a second one", (t) => {
  const root = makeRepo(t, { pages: { "docs/fr/a.md": "# A\n" } });
  const target = path.join(root, "docs/fr/a.md");

  writeSourceStamp(target, "old");
  assert.equal(writeSourceStamp(target, "new"), "updated");

  const occurrences = fs.readFileSync(target, "utf8").match(/i18n_source_sha/g) || [];
  assert.equal(occurrences.length, 1);
  assert.equal(readSourceStamp(target), "new");
});

test("readSourceStamp returns null when it cannot judge, rather than guessing", (t) => {
  const root = makeRepo(t, {
    pages: {
      "docs/fr/none.md": "# No front matter\n",
      "docs/fr/other.md": "---\ntitle: X\n---\n\n# Other keys only\n",
    },
  });

  assert.equal(readSourceStamp(path.join(root, "docs/fr/none.md")), null);
  assert.equal(readSourceStamp(path.join(root, "docs/fr/other.md")), null);
  assert.equal(readSourceStamp(path.join(root, "docs/fr/absent.md")), null);
});

/* ------------- unit: pure helpers / unitaire : fonctions pures ----------- */

test("isSourceDoc separates English sources from everything else", () => {
  const locales = ["fr", "pt"];
  assert.equal(isSourceDoc("docs/technical/guide.md", locales), true);
  assert.equal(isSourceDoc("docs/fr/technical/guide.md", locales), false);
  assert.equal(isSourceDoc("docs/pt/index.md", locales), false, "a locale page is not a source");
  assert.equal(isSourceDoc("docs/.vuepress/config.js", locales), false);
  assert.equal(isSourceDoc("docs/technical/diagram.svg", locales), false);
  assert.equal(isSourceDoc("README.md", locales), false);
});

test("path mapping round-trips between source and translation", () => {
  const source = "docs/technical/deployment/README.md";
  const localized = toLocalizedPath(source, "fr");
  assert.equal(localized, "docs/fr/technical/deployment/README.md");
  assert.equal(toSourcePath(localized, "fr"), source);
});

test("parseArgs accepts both --key value and --key=value", () => {
  assert.deepEqual(parseArgs(["--base", "main", "--audit"]), { base: "main", audit: "true" });
  assert.deepEqual(parseArgs(["--base=main"]), { base: "main" });
  assert.deepEqual(parseArgs(["--stamp"]), { stamp: "true" });
});

test("resolveFailOn blocks on nothing unless asked", () => {
  assert.deepEqual(resolveFailOn({}), []);
  assert.deepEqual(resolveFailOn({ "fail-on": "none" }), []);
  assert.deepEqual(resolveFailOn({ "fail-on": "missing,orphaned" }), ["missing", "orphaned"]);
  assert.deepEqual(resolveFailOn({ "fail-on-missing": "true" }), ["missing"]);
});

/* --- integration: hash mechanism / intégration : mécanisme d'empreinte --- */

test("a cosmetic edit to a translation cannot pass as a real translation", (t) => {
  const root = makeRepo(t, {
    pages: {
      "docs/technical/guide.md": SOURCE_PAGE,
      "docs/fr/technical/guide.md": TRANSLATED_PAGE,
    },
  });

  run(root, ["--stamp"]);
  commit(root, "stamp translations");

  // The English page really changes; the French page gets an unrelated comma and keeps its
  // now-outdated stamp. Both files land in the same diff - which is exactly what used to
  // fool the check.
  // FR : la page anglaise change vraiment ; la page française reçoit une virgule sans rapport
  // et conserve son empreinte désormais périmée. Les deux fichiers se retrouvent dans le même
  // diff — c'est exactement ce qui trompait le contrôle auparavant.
  write(root, "docs/technical/guide.md", "# Guide\n\nDeployment now takes five steps.\n");
  const french = path.join(root, "docs/fr/technical/guide.md");
  fs.writeFileSync(french, fs.readFileSync(french, "utf8").replace("etapes.", "etapes,"), "utf8");
  commit(root, "edit english and only tweak french");

  const changed = git(root, ["diff", "--name-only", "HEAD~1...HEAD"]);
  assert.match(changed, /docs\/fr\/technical\/guide\.md/, "both files must be in the diff");
  assert.match(changed, /docs\/technical\/guide\.md/);

  const { stdout } = run(root, ["--base", "HEAD~1", "--head", "HEAD"]);
  assert.match(stdout, /needs_review/);
  assert.doesNotMatch(stdout, /✅ updated \| 1/, "must not be reported as up to date");
});

test("translating properly and refreshing the stamp clears the drift", (t) => {
  const root = makeRepo(t, {
    pages: {
      "docs/technical/guide.md": SOURCE_PAGE,
      "docs/fr/technical/guide.md": TRANSLATED_PAGE,
    },
  });

  run(root, ["--stamp"]);
  commit(root, "stamp translations");

  write(root, "docs/technical/guide.md", "# Guide\n\nDeployment now takes five steps.\n");
  write(root, "docs/fr/technical/guide.md", "# Guide\n\nLe deploiement se fait en cinq etapes.\n");
  run(root, ["--stamp"]);
  commit(root, "translate and refresh the stamp");

  const { stdout, code } = run(root, ["--audit", "--fail-on", "stale,missing,orphaned"]);
  assert.equal(code, 0);
  assert.match(stdout, /up-to-date translation/);
});

test("an unstamped translation is reported, not silently trusted", (t) => {
  const root = makeRepo(t, {
    pages: {
      "docs/technical/guide.md": SOURCE_PAGE,
      "docs/fr/technical/guide.md": TRANSLATED_PAGE,
    },
  });

  const { stdout, code } = run(root, ["--audit"]);
  assert.match(stdout, /unstamped/);
  assert.equal(code, 0, "an unstamped page is visible but never blocking");
});

test("a stale stamp is caught by the audit even with no diff involved", (t) => {
  const root = makeRepo(t, {
    pages: {
      "docs/technical/guide.md": SOURCE_PAGE,
      "docs/fr/technical/guide.md": TRANSLATED_PAGE,
    },
  });

  run(root, ["--stamp"]);
  write(root, "docs/technical/guide.md", "# Guide\n\nCompletely rewritten.\n");
  commit(root, "rewrite the english page");

  const { stdout, code } = run(root, ["--audit", "--fail-on", "stale"]);
  assert.match(stdout, /stale/);
  assert.equal(code, 2);
});

/* --- integration: drift classes / intégration : classes de dérive -------- */

test("a deleted source makes its translation orphaned, not missing", (t) => {
  const root = makeRepo(t, {
    pages: {
      "docs/product/legacy.md": "# Legacy\n",
      "docs/fr/product/legacy.md": "# Legacy FR\n",
    },
  });

  fs.rmSync(path.join(root, "docs/product/legacy.md"));
  commit(root, "delete the english page");

  const { stdout } = run(root, ["--base", "HEAD~1", "--head", "HEAD"]);
  assert.match(stdout, /orphaned/);
  assert.doesNotMatch(stdout, /docs\/fr\/product\/legacy\.md` \(missing\)/);
});

test("a renamed source orphans the old translation and asks for the new path", (t) => {
  const root = makeRepo(t, {
    pages: {
      "docs/technical/guide.md": SOURCE_PAGE,
      "docs/fr/technical/guide.md": TRANSLATED_PAGE,
    },
  });

  git(root, ["mv", "docs/technical/guide.md", "docs/technical/guide-v2.md"]);
  commit(root, "rename the english page");

  const { stdout } = run(root, ["--base", "HEAD~1", "--head", "HEAD"]);
  assert.match(stdout, /docs\/fr\/technical\/guide\.md`? \(orphaned\)/);
  assert.match(stdout, /docs\/fr\/technical\/guide-v2\.md`? \(missing\)/);
});

test("a brand-new source page is reported as missing a translation", (t) => {
  const root = makeRepo(t, { pages: { "docs/technical/guide.md": SOURCE_PAGE } });

  write(root, "docs/technical/brand-new.md", "# Brand new\n");
  commit(root, "add an english page");

  const { stdout, code } = run(root, ["--base", "HEAD~1", "--head", "HEAD", "--fail-on", "missing"]);
  assert.match(stdout, /docs\/fr\/technical\/brand-new\.md`? \(missing\)/);
  assert.equal(code, 2);
});

/* --- integration: scope + refs / intégration : périmètre et refs --------- */

test("an out-of-scope locale is never mistaken for an English source", (t) => {
  const root = makeRepo(t, {
    locales: ["fr"],
    pages: {
      "docs/pt/index.md": "# Inicio\n",
      "docs/technical/guide.md": SOURCE_PAGE,
      "docs/fr/technical/guide.md": TRANSLATED_PAGE,
      "scripts/i18n-baseline.json": JSON.stringify(
        { ignoredLocales: { pt: "not started" }, entries: [] },
        null,
        2
      ),
    },
  });

  write(root, "docs/pt/index.md", "# Inicio revisto\n");
  commit(root, "edit the portuguese page");

  const { stdout } = run(root, ["--base", "HEAD~1", "--head", "HEAD"]);
  // The regression this guards against: demanding a French translation of a Portuguese page.
  // FR : la régression que ce test verrouille — réclamer la traduction française d'une page
  // portugaise.
  assert.doesNotMatch(stdout, /docs\/fr\/pt\//);
});

test("a ref containing shell metacharacters cannot execute anything", (t) => {
  const root = makeRepo(t, { pages: { "docs/technical/guide.md": SOURCE_PAGE } });
  const witness = path.join(root, "pwned.txt");

  // `evil;touch$IFSpwned` is a valid git branch name, so refs genuinely can carry shell
  // metacharacters. If runGit ever goes back to interpolating into a shell string, the
  // command substitution below runs and the witness file appears.
  // FR : `evil;touch$IFSpwned` est un nom de branche git valide, les refs peuvent donc
  // réellement transporter des métacaractères shell. Si runGit se remettait à interpoler dans
  // une chaîne shell, la substitution ci-dessous s'exécuterait et le fichier témoin apparaîtrait.
  for (const hostile of [
    `master $(touch ${witness})`,
    `master; touch ${witness}`,
    `master\`touch ${witness}\``,
  ]) {
    run(root, ["--base", hostile, "--head", "HEAD"]);
    assert.equal(fs.existsSync(witness), false, `a shell interpreted: ${hostile}`);
  }
});

test("a hostile ref is treated as a ref name, not as code", (t) => {
  const root = makeRepo(t, { pages: { "docs/technical/guide.md": SOURCE_PAGE } });

  // It must not crash either: the ref simply does not resolve, and the usual fallback runs.
  // FR : cela ne doit pas non plus planter — la ref ne résout tout simplement pas, et le
  // repli habituel s'applique.
  const { code, stderr } = run(root, ["--base", "master; rm -rf /", "--head", "HEAD"]);
  assert.equal(code, 0);
  assert.match(stderr, /not found\. Falling back/);
});

test("an unresolvable base ref fails loudly instead of reporting a clean run", (t) => {
  const root = makeRepo(t, {
    branch: "work",
    pages: { "docs/technical/guide.md": SOURCE_PAGE },
  });

  const { code, stderr, stdout } = run(root, ["--base", "does-not-exist"]);
  assert.equal(code, 1);
  assert.match(stderr, /could not be resolved/);
  assert.doesNotMatch(stdout, /No source documentation changed/);
});

/* --- integration: baseline / intégration : la baseline ------------------- */

test("baseline debt is reported but does not block", (t) => {
  const root = makeRepo(t, { pages: { "docs/technical/guide.md": SOURCE_PAGE } });

  const frozen = run(root, ["--audit", "--update-baseline"]);
  assert.equal(frozen.code, 0, `freezing the baseline must succeed: ${frozen.stderr}`);

  const { stdout, code } = run(root, ["--audit", "--fail-on", "missing"]);

  assert.equal(code, 0, "frozen debt must not fail the build");
  assert.match(stdout, /No new drift/);
});

test("regenerating the baseline preserves ignoredLocales and is idempotent", (t) => {
  const root = makeRepo(t, {
    pages: {
      "docs/technical/guide.md": SOURCE_PAGE,
      "scripts/i18n-baseline.json": JSON.stringify(
        { ignoredLocales: { pt: "not started" }, entries: [] },
        null,
        2
      ),
    },
  });

  run(root, ["--audit", "--update-baseline"]);
  const first = fs.readFileSync(path.join(root, "scripts/i18n-baseline.json"), "utf8");
  assert.match(first, /"pt"/, "a team decision must survive regeneration");

  run(root, ["--audit", "--update-baseline"]);
  const second = fs.readFileSync(path.join(root, "scripts/i18n-baseline.json"), "utf8");

  // generatedAt legitimately moves; nothing else may.
  // FR : `generatedAt` bouge légitimement ; rien d'autre ne doit bouger.
  const strip = (text) => text.replace(/"generatedAt": "[^"]*"/, "");
  assert.equal(strip(second), strip(first));
});

test("--update-baseline refuses to run against a diff range", (t) => {
  const root = makeRepo(t, { pages: { "docs/technical/guide.md": SOURCE_PAGE } });

  const { code, stderr } = run(root, ["--update-baseline"]);
  assert.equal(code, 1);
  assert.match(stderr, /requires --audit/);
});
