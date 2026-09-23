#!/usr/bin/env node
// live-check — point jev-triage at a repo you know well and check it still ranks it correctly.
//
//   node examples/live-check.mjs --config mine.json
//   node examples/live-check.mjs --config mine.json --repo ../other-repo
//
// This is a demo and a hand-run sanity check, NOT part of the test suite: it needs a key, costs
// real money, and depends on a codebase that only you have. The offline suite in tests/ is the
// gate. Keep this for the moments when you have changed something that could move a ranking —
// chunking, a pattern, the role question — and want evidence on real code.
//
// Ground truth is yours to supply. Establish it by reading the code FIRST, then encode it; a
// check written by looking at the tool's output proves only that the tool agrees with itself.
//
// Config (every field overridable by the matching --flag):
//
//   {
//     "repo": "../audioviz",                      // required: the repo to sweep
//     "src": "src",                               // subdirectory to walk (default: src)
//     "ext": [".ts", ".tsx"],                     // extensions to consider
//     "question": "This file itself computes …",  // or "pattern" + "subject"
//     "expect_top": ["src/a.ts", "src/b.ts"],     // must occupy the top N, in any order
//     "expect_below": { "score": 0.05, "files": ["src/trap.ts"] },
//     "expect_hunk": { "file": "src/b.ts", "contains": "Meyda.extract(" }
//   }
//
// expect_hunk anchors on a string rather than a line number so that edits elsewhere in the file
// do not fail the check for a reason that has nothing to do with ranking.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import {
  runSweep, runHunks, resolveConfig, resolveQuestion, walk,
  CONCURRENCY, HUNK_LINES, HUNK_OVERLAP,
} from "../scripts/jev.mjs";

const { values: flags } = parseArgs({
  options: {
    config: { type: "string" }, repo: { type: "string" }, src: { type: "string" },
    ext: { type: "string" }, question: { type: "string" },
    pattern: { type: "string" }, subject: { type: "string" },
  },
});

const die = (msg) => { process.stderr.write(`live-check: ${msg}\n`); process.exit(2); };

let conf = {};
if (flags.config) {
  if (!existsSync(flags.config)) die(`config not found: ${flags.config}`);
  try { conf = JSON.parse(readFileSync(flags.config, "utf8")); }
  catch (e) { die(`config is not valid JSON: ${e.message}`); }
} else if (!flags.repo) {
  die("need --config FILE, or at least --repo with --question\n\n" +
      "See examples/live-check.example.json for the shape.");
}

// Flags win over the file, so one config serves several repos.
const repo = flags.repo ?? conf.repo;
const src = flags.src ?? conf.src ?? "src";
const exts = (flags.ext ? flags.ext.split(",") : conf.ext) ?? [".ts", ".tsx"];
if (!repo) die("no repo: set it in the config or pass --repo");
if (!existsSync(repo)) die(`repo not found: ${repo}`);

let question;
try {
  question = resolveQuestion({
    question: flags.question ?? conf.question,
    pattern: flags.pattern ?? conf.pattern,
    subject: flags.subject ?? conf.subject,
  });
} catch (e) { die(e.message); }

const cfg = resolveConfig(process.env);
if (cfg.error) die(cfg.error);

const expectTop = conf.expect_top ?? [];
const expectBelow = conf.expect_below ?? null;
const expectHunk = conf.expect_hunk ?? null;

let failures = 0;
const check = (name, pass, detail = "") => {
  process.stdout.write(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}\n`);
  if (!pass) failures++;
};

const opts = { concurrency: CONCURRENCY, size: HUNK_LINES, overlap: HUNK_OVERLAP, noRole: false };
const rel = (p) => relative(repo, p);

// ---- Pass 1: whole-file sweep ---------------------------------------------------------------
const root = join(repo, src);
if (!existsSync(root)) die(`${root} does not exist — set "src" in the config`);
const files = walk(root, exts);
if (!files.length) die(`no ${exts.join("/")} files under ${root}`);

process.stdout.write(`\nPASS 1 — sweeping ${files.length} files under ${rel(root) || src}\n`);
const { rows } = await runSweep(files, question, cfg, opts);
const ok = rows.filter((r) => r.ok).sort((a, b) => b.score - a.score);
const failed = rows.filter((r) => !r.ok);
const scoreOfFile = (f) => ok.find((r) => rel(r.label) === f)?.score;

for (const r of ok.slice(0, Math.max(5, expectTop.length))) {
  process.stdout.write(`  ${r.score.toFixed(2)}  ${rel(r.label)}\n`);
}
if (failed.length) process.stdout.write(`  (${failed.length} not classified)\n`);

if (expectTop.length) {
  const top = ok.slice(0, expectTop.length).map((r) => rel(r.label));
  for (const want of expectTop) {
    check(`${want} is in the top ${expectTop.length}`, top.includes(want),
      scoreOfFile(want) === undefined ? "not ranked at all" : `scored ${scoreOfFile(want).toFixed(2)}`);
  }
}
if (expectBelow) {
  const limit = expectBelow.score ?? 0.05;
  for (const f of expectBelow.files ?? []) {
    const s = scoreOfFile(f);
    check(`${f} stays below ${limit}`, s !== undefined && s < limit,
      s === undefined ? "not ranked at all" : `scored ${s.toFixed(2)}`);
  }
}

// ---- Pass 2: hunks within one known file ----------------------------------------------------
if (expectHunk) {
  const target = join(repo, expectHunk.file);
  if (!existsSync(target)) die(`expect_hunk.file not found: ${target}`);
  const lines = readFileSync(target, "utf8").split("\n");
  const idx = lines.findIndex((l) => l.includes(expectHunk.contains));
  if (idx === -1) die(`expect_hunk.contains not found in ${expectHunk.file}: ${expectHunk.contains}`);
  const wantLine = idx + 1;

  process.stdout.write(`\nPASS 2 — hunks within ${expectHunk.file} (anchor on line ${wantLine})\n`);
  const h = await runHunks([target], question, cfg, opts);
  const hok = h.rows.filter((r) => r.ok).sort((a, b) => b.score - a.score);
  for (const r of hok.slice(0, 3)) process.stdout.write(`  ${r.score.toFixed(2)}  ${r.lo}-${r.hi}\n`);
  const best = hok[0];
  check(`top hunk contains ${JSON.stringify(expectHunk.contains)}`,
    !!best && wantLine >= best.lo && wantLine <= best.hi,
    best ? `top hunk is ${best.lo}-${best.hi}` : "no hunk scored");
}

process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : "all checks passed"}\n`);
if (failures) {
  process.stdout.write(
    "A failure here means the ranking moved. Work out why before relaxing anything — the point\n" +
    "of hand-established ground truth is that it does not bend to make a change pass.\n");
}
process.exit(failures ? 1 : 0);
