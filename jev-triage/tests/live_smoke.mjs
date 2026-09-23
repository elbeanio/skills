#!/usr/bin/env node
// Live regression against established ground truth. Needs a key and network.
//
//   AUDIOVIZ=../audioviz node tests/live_smoke.mjs
//
// These assertions encode ground truth established by hand — the audioviz code was read and
// understood before the tool was ever pointed at it. They are the guard against a change
// silently ranking worse while still looking plausible.
//
// DO NOT relax an assertion to make a change pass. If one fails, the ranking regressed.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runSweep, runHunks, resolveConfig, walk, CONCURRENCY, HUNK_LINES, HUNK_OVERLAP }
  from "../scripts/jev.mjs";

const REPO = process.env.AUDIOVIZ ?? join(process.cwd(), "..", "audioviz");

// Ground truth: audioviz has no first-party FFT. Meyda does it; extractSignals.ts drives Meyda
// and post-processes the result; analysisWorker.ts owns the pipeline. dsp.ts, spectrograph.ts
// and radialSpectrum.ts all merely consume or render a spectrum computed elsewhere — and all
// three are exactly what a naive grep surfaces first.
const Q1 =
  "This file contains code that itself computes a frequency-domain transform of audio (an FFT, " +
  "DFT, or equivalent spectral analysis), or directly drives a Web Audio AnalyserNode to obtain " +
  "frequency-bin data. Merely consuming, rendering, storing, configuring, or describing " +
  "already-computed spectral data does NOT count.";

const Q2 =
  "This excerpt is where audio spectral/frequency analysis is actually driven or produced — the " +
  "code that obtains frequency-domain data. Excerpts that merely declare types, set constants, " +
  "import, or post-process values obtained elsewhere do NOT count.";

const EXPECT_TOP = ["src/analysis/analysisWorker.ts", "src/analysis/extractSignals.ts"];
const EXPECT_LOW = [
  "src/analysis/dsp.ts",
  "src/render/visualisations/spectrograph.ts",
  "src/render/visualisations/radialSpectrum.ts",
];
const MEYDA_EXTRACT_LINE = 113; // the Meyda.extract() call in extractSignals.ts

let failures = 0;
const check = (name, cond, detail = "") => {
  process.stdout.write(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? `  (${detail})` : ""}\n`);
  if (!cond) failures++;
};

const cfg = resolveConfig(process.env);
if (cfg.error) { process.stderr.write(`live_smoke: ${cfg.error}\n`); process.exit(2); }
if (!existsSync(REPO)) {
  process.stderr.write(`live_smoke: audioviz not found at ${REPO} — set AUDIOVIZ=/path/to/audioviz\n`);
  process.exit(2);
}

const opts = { concurrency: CONCURRENCY, size: HUNK_LINES, overlap: HUNK_OVERLAP, noRole: false };
const rel = (p) => p.slice(REPO.length + 1);

// ---- Pass 1: whole-file sweep -------------------------------------------------------------
process.stdout.write("\nPASS 1 — file sweep over audioviz/src\n");
const files = walk(join(REPO, "src"), [".ts", ".tsx"]);
check("corpus is the expected size", files.length > 150, `${files.length} files`);

const t0 = Date.now();
const { rows } = await runSweep(files, Q1, cfg, opts);
const ok = rows.filter((r) => r.ok).sort((a, b) => b.score - a.score);
const cost1 = rows.reduce((s, r) => s + (r.cost ?? 0), 0);

process.stdout.write(`  top 5: ${ok.slice(0, 5).map((r) => `${rel(r.label)} ${r.score.toFixed(2)}`).join(", ")}\n`);

const top2 = ok.slice(0, 2).map((r) => rel(r.label)).sort();
check("the two pipeline files rank top-2", JSON.stringify(top2) === JSON.stringify([...EXPECT_TOP].sort()),
  top2.join(" + "));

for (const f of EXPECT_LOW) {
  const row = ok.find((r) => rel(r.label) === f);
  check(`trap stays below 0.05: ${f}`, row && row.score < 0.05, row ? row.score.toFixed(2) : "not found");
}

const spectrograph = ok.find((r) => rel(r.label) === "src/render/visualisations/spectrograph.ts");
check("spectrograph is classified as a renderer, not an implementer",
  spectrograph && spectrograph.role !== "implements", spectrograph?.role);

// Separation, not absolute scores. Scores move run to run — one sweep had extractSignals at
// 0.48 and the next at 0.62, with the top two swapping places — so an assertion on exact values
// or on a band happening to be empty tests nothing. What has held across every run is the *gap*
// between the pipeline files and everything else.
check("clear gap between the pipeline files and the rest",
  ok[1].score - ok[2].score > 0.15, `${ok[1].score.toFixed(2)} -> ${ok[2].score.toFixed(2)}`);
check("top score is well clear of the highest trap",
  ok[0].score > 4 * Math.max(...EXPECT_LOW.map((f) => ok.find((r) => rel(r.label) === f)?.score ?? 0)));

// ---- Pass 2: hunk ranking -----------------------------------------------------------------
process.stdout.write("\nPASS 2 — hunk ranking\n");
const target = join(REPO, "src/analysis/extractSignals.ts");
const h = await runHunks([target], Q2, cfg, opts);
const hok = h.rows.filter((r) => r.ok).sort((a, b) => b.score - a.score);
process.stdout.write(`  top 3: ${hok.slice(0, 3).map((r) => `${r.lo}-${r.hi} ${r.score.toFixed(2)}`).join(", ")}\n`);

const best = hok[0];
check("top hunk contains the Meyda.extract call",
  best && best.lo <= MEYDA_EXTRACT_LINE && best.hi >= MEYDA_EXTRACT_LINE,
  best ? `${best.lo}-${best.hi}` : "none");
check("top hunk is confident", best && best.score > 0.6, best?.score.toFixed(2));

// Negative control: a file that only consumes a spectrum must localise nowhere.
const ctl = await runHunks([join(REPO, "src/analysis/dsp.ts")], Q2, cfg, opts);
const ctlMax = Math.max(...ctl.rows.filter((r) => r.ok).map((r) => r.score));
check("negative control (dsp.ts) stays flat", ctlMax < 0.15, ctlMax.toFixed(2));

const cost2 = h.rows.concat(ctl.rows).reduce((s, r) => s + (r.cost ?? 0), 0);
process.stdout.write(
  `\n${failures ? `${failures} REGRESSION(S)` : "all checks passed"} | ` +
  `${((Date.now() - t0) / 1000).toFixed(1)}s | $${(cost1 + cost2).toFixed(4)}\n`,
);
process.exit(failures ? 1 : 0);
