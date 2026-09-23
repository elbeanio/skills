import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

import {
  chunkLines, capState, bands, formatSweep, formatHunks, resolveConfig, resolveQuestion,
  classifyStatus, decide, mapPool, FatalApiError, PATTERNS, DEFAULT_MODEL, MAX_STATE_CHARS, hunkAdvice,
  scoreOf, runSweep, runHunks, walk, main,
} from "../scripts/jev.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_MD = join(HERE, "..", "SKILL.md");

describe("chunkLines", () => {
  test("covers every line", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}\n`);
    const cs = chunkLines(lines, 40, 0.25);
    assert.equal(cs[0].lo, 1);
    assert.equal(cs.at(-1).hi, 100, "last chunk must reach the final line");
    const covered = new Set();
    for (const c of cs) for (let n = c.lo; n <= c.hi; n++) covered.add(n);
    assert.equal(covered.size, 100, "no line may be skipped");
  });

  test("overlaps by the requested fraction", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `${i}\n`);
    const cs = chunkLines(lines, 40, 0.25);
    // step = 30, so chunk 2 starts at line 31 and overlaps chunk 1 (1-40) by 10 lines.
    assert.equal(cs[1].lo, 31);
    assert.ok(cs[1].lo <= cs[0].hi, "adjacent chunks must overlap, not merely abut");
  });

  test("zero overlap still advances and terminates", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `${i}\n`);
    const cs = chunkLines(lines, 4, 0);
    assert.deepEqual(cs.map((c) => [c.lo, c.hi]), [[1, 4], [5, 8], [9, 10]]);
  });

  test("handles empty and single-line input", () => {
    assert.deepEqual(chunkLines([], 40, 0.25), []);
    const one = chunkLines(["only\n"], 40, 0.25);
    assert.equal(one.length, 1);
    assert.deepEqual([one[0].lo, one[0].hi], [1, 1]);
  });

  test("file shorter than the window yields one chunk", () => {
    const cs = chunkLines(Array.from({ length: 5 }, () => "x\n"), 40, 0.25);
    assert.equal(cs.length, 1);
  });
});

describe("capState", () => {
  test("passes short states through untouched", () => {
    const { text, truncated } = capState("short");
    assert.equal(text, "short");
    assert.equal(truncated, false);
  });

  test("truncates oversized states and marks the cut", () => {
    const { text, truncated } = capState("x".repeat(MAX_STATE_CHARS + 500));
    assert.equal(truncated, true);
    assert.ok(text.includes("truncated"), "a truncation must never be silent");
    assert.ok(text.length < MAX_STATE_CHARS + 200);
  });
});

describe("bands", () => {
  test("counts each band, boundaries included at the lower edge", () => {
    const out = bands([0.01, 0.04, 0.05, 0.19, 0.2, 0.44, 0.45, 0.9, 1.0]);
    assert.equal(out, "2 <0.05  2 0.05-0.20  2 0.20-0.45  3 >0.45");
  });

  test("empty input reports all zeroes", () => {
    assert.equal(bands([]), "0 <0.05  0 0.05-0.20  0 0.20-0.45  0 >0.45");
  });
});

describe("formatSweep", () => {
  const rows = [
    { ok: true, label: "a.ts", score: 0.9, role: "implements", conf: 0.98 },
    { ok: true, label: "b.ts", score: 0.5, role: "consumes", conf: 0.8 },
    { ok: true, label: "c.ts", score: 0.3, role: "consumes", conf: 0.7 },
    { ok: true, label: "d.ts", score: 0.1, role: "declares", conf: 0.6 },
  ];

  test("ranks descending and honours --top", () => {
    const out = formatSweep(rows, { top: 2 });
    const body = out.split("\n").filter((l) => l.includes(".ts") && !l.startsWith("--"));
    assert.equal(body.length, 2);
    assert.ok(body[0].includes("a.ts"));
    assert.ok(body[1].includes("b.ts"));
  });

  test("names the rows just below the cut so a drop is visible", () => {
    const out = formatSweep(rows, { top: 2 });
    assert.ok(out.includes("next below the cut"));
    assert.ok(out.includes("c.ts"), "the highest unshown row must be named");
  });

  test("names failures and distinguishes them from low scores", () => {
    const out = formatSweep(rows, { top: 2, failures: [{ label: "z.ts", error: "HTTP 403" }] });
    assert.ok(out.includes("NOT CLASSIFIED"));
    assert.ok(out.includes("z.ts"));
    assert.ok(out.includes("403"));
  });

  test("reports throttling when it occurred", () => {
    assert.ok(formatSweep(rows, { throttled: true }).includes("throttled"));
    assert.ok(!formatSweep(rows, { throttled: false }).includes("throttled"));
  });

  test("--all shows everything and then has nothing below the cut", () => {
    const out = formatSweep(rows, { all: true });
    for (const r of rows) assert.ok(out.includes(r.label));
    assert.ok(!out.includes("next below the cut"));
  });
});

describe("formatHunks", () => {
  test("emits a runnable sed command per hunk", () => {
    const out = formatHunks([{ ok: true, file: "src/x.ts", lo: 91, hi: 130, score: 0.89 }]);
    assert.ok(out.includes("src/x.ts:91-130"));
    assert.ok(out.includes("sed -n '91,130p' src/x.ts"), "output must be actionable with bash alone");
  });
});

describe("resolveConfig", () => {
  test("requires both dedicated vars", () => {
    assert.ok(resolveConfig({}).error.includes("JEV_TRIAGE_KEY"));
    assert.ok(resolveConfig({}).error.includes("JEV_TRIAGE_API_BASE"));
    assert.ok(resolveConfig({ JEV_TRIAGE_KEY: "k" }).error.includes("JEV_TRIAGE_API_BASE"));
  });

  test("never falls back to a generic key var", () => {
    const r = resolveConfig({ OPENROUTER_API_KEY: "broad-key", JEV_TRIAGE_API_BASE: "https://x" });
    assert.ok(r.error, "a generic key must not satisfy the requirement");
    assert.ok(!JSON.stringify(r).includes("broad-key"), "a key value must never be echoed");
  });

  test("defaults the model and accepts an override", () => {
    const base = { JEV_TRIAGE_KEY: "k", JEV_TRIAGE_API_BASE: "https://x" };
    assert.equal(resolveConfig(base).model, DEFAULT_MODEL);
    assert.equal(resolveConfig({ ...base, JEV_TRIAGE_MODEL: "jev-latest" }).model, "jev-latest");
  });

  test("the error message explains the full-URL requirement", () => {
    const e = resolveConfig({}).error;
    assert.ok(e.includes("api/alpha/decisions") && e.includes("v1/systemone"),
      "both backend paths must be shown, since the var is a full URL not a host");
  });
});

describe("resolveQuestion", () => {
  test("passes an explicit question through", () => {
    assert.equal(resolveQuestion({ question: "is this X?" }), "is this X?");
  });

  test("expands a pattern with its subject", () => {
    const q = resolveQuestion({ pattern: "implements-vs-references", subject: "token refresh" });
    assert.ok(q.includes("token refresh"));
    assert.ok(q.includes("rather than"), "the distinction clause is what makes a question work");
  });

  test("rejects an unknown pattern and a pattern without a subject", () => {
    assert.throws(() => resolveQuestion({ pattern: "nope", subject: "x" }), /unknown pattern/);
    assert.throws(() => resolveQuestion({ pattern: "implements-vs-references" }), /--subject/);
  });

  test("rejects having neither", () => {
    assert.throws(() => resolveQuestion({}), /need --question/);
  });

  test("every shipped pattern is categorical, never relational", () => {
    // Relational questions are unanswerable by a classifier scoring one state in isolation.
    // This was established empirically against real build logs; the patterns must not regress.
    const banned = /\b(earliest|original|root cause|first|before|after|preceding)\b/i;
    for (const [name, p] of Object.entries(PATTERNS)) {
      assert.ok(!banned.test(p.q("the subject")), `pattern '${name}' uses relational language`);
    }
  });
});

describe("classifyStatus", () => {
  test("401 and 402 are fatal", () => {
    assert.equal(classifyStatus(401).fatal, true);
    assert.equal(classifyStatus(402).fatal, true);
    assert.equal(classifyStatus(402).kind, "credit");
  });

  test("402 is distinguishable from throttling and from a content rejection", () => {
    assert.notEqual(classifyStatus(402).kind, classifyStatus(429).kind);
    assert.notEqual(classifyStatus(403).kind, classifyStatus(429).kind);
  });

  test("429 and 5xx retry; 400 does not", () => {
    assert.equal(classifyStatus(429).retry, true);
    assert.equal(classifyStatus(503).retry, true);
    assert.equal(classifyStatus(400).retry, false);
  });
});

const okBody = { answers: { hit: { noul: 0.8 } }, usage: { cost: 0.001, input_tokens: 10 } };
const stub = (seq) => {
  let i = 0;
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    const r = seq[Math.min(i++, seq.length - 1)];
    return { ok: r.status === 200, status: r.status, json: async () => r.body ?? okBody };
  };
  f.calls = calls;
  return f;
};
const CFG = { key: "secret-key", base: "https://x", model: "m" };

describe("decide", () => {
  test("returns the parsed answer on success", async () => {
    const r = await decide("s", {}, CFG, { fetchImpl: stub([{ status: 200 }]) });
    assert.equal(r.ok, true);
    assert.equal(r.answers.hit.noul, 0.8);
  });

  test("sends the decisions shape only — never a chat-completions body", async () => {
    const f = stub([{ status: 200 }]);
    await decide("my-state", { hit: { type: "noul" } }, CFG, { fetchImpl: f });
    const sent = JSON.parse(f.calls[0].init.body);
    assert.deepEqual(Object.keys(sent).sort(), ["model", "questions", "state"]);
    assert.ok(!("messages" in sent), "a broad key must not be spendable on chat completions here");
  });

  test("retries a 429 and then succeeds", async () => {
    const f = stub([{ status: 429 }, { status: 200 }]);
    const r = await decide("s", {}, CFG, { fetchImpl: f });
    assert.equal(r.ok, true);
    assert.equal(r.throttled, true, "throttling must be reported even when the retry succeeds");
    assert.equal(f.calls.length, 2);
  });

  test("never retries a 402 and raises it as fatal", async () => {
    const f = stub([{ status: 402 }]);
    await assert.rejects(() => decide("s", {}, CFG, { fetchImpl: f }), FatalApiError);
    assert.equal(f.calls.length, 1, "a spent key must not be retried");
  });

  test("gives up on a repeated 403 without throwing", async () => {
    const r = await decide("s", {}, CFG, { fetchImpl: stub([{ status: 403 }]), retries: 2 });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("403"));
  });

  test("a 400 is not retried", async () => {
    const f = stub([{ status: 400 }]);
    const r = await decide("s", {}, CFG, { fetchImpl: f });
    assert.equal(r.ok, false);
    assert.equal(f.calls.length, 1);
  });
});

describe("mapPool", () => {
  test("preserves input order regardless of completion order", async () => {
    const out = await mapPool([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms / 10));
      return ms;
    });
    assert.deepEqual(out, [30, 10, 20]);
  });

  test("respects the concurrency limit", async () => {
    let live = 0, peak = 0;
    await mapPool(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      live++; peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live--;
    });
    assert.ok(peak <= 4, `peak concurrency ${peak} exceeded the limit`);
  });

  test("handles an empty list", async () => {
    assert.deepEqual(await mapPool([], 4, async () => 1), []);
  });
});

describe("SKILL.md portability", () => {
  const src = readFileSync(SKILL_MD, "utf8");
  const fm = src.split(/^---$/m)[1];

  test("has frontmatter", () => assert.ok(fm, "SKILL.md must open with YAML frontmatter"));

  test("declares ONLY name and description", () => {
    // Claude Code and Pi both require exactly these two. Any extra field risks one harness
    // rejecting the skill; this test is the portability guard.
    const keys = fm.split("\n").filter((l) => /^[a-zA-Z][\w-]*:/.test(l)).map((l) => l.split(":")[0]);
    assert.deepEqual(keys.sort(), ["description", "name"]);
  });

  test("description fits Pi's 1024-char limit and says when to use it", () => {
    const desc = fm.match(/^description:\s*(.+)$/m)[1];
    assert.ok(desc.length <= 1024, `description is ${desc.length} chars`);
    assert.ok(/\buse when\b/i.test(desc), "the description is the routing signal; it must say when");
  });

  test("names no harness-specific tool", () => {
    // "use Explore instead" is meaningless in Pi, which has no sub-agents.
    assert.ok(!/\bExplore\b/.test(src), "instructions must stay harness-neutral");
  });

  test("records the non-uses that were established empirically", () => {
    for (const phrase of ["Multi-hop", "Absence", "repetitive"]) {
      assert.ok(src.includes(phrase), `SKILL.md must warn about: ${phrase}`);
    }
  });
});

describe("hunkAdvice", () => {
  const mk = (file, scores) => scores.map((s, i) => ({ ok: true, file, lo: i * 30 + 1, hi: i * 30 + 40, score: s }));

  test("says read-whole when nothing localises", () => {
    const out = hunkAdvice(mk("a.ts", [0.1, 0.05, 0.02]), ["a.ts"]);
    assert.equal(out.length, 1);
    assert.match(out[0], /no hunk localised/);
    assert.match(out[0], /does not.*answer the question/, "message must not assume the file came from a sweep");
  });

  test("says read-whole when everything is on-subject", () => {
    // exportVideo.ts hit this for real: 17 of 27 hunks above 0.45, because the entire file is
    // about the subject. A ranking inside it is noise and must not be presented as a finding.
    const out = hunkAdvice(mk("b.ts", [0.94, 0.92, 0.91, 0.89, 0.6]), ["b.ts"]);
    assert.equal(out.length, 1);
    assert.match(out[0], /whole file is about this/);
  });

  test("stays quiet when a file genuinely localises", () => {
    // extractSignals.ts: one clear peak, the rest low. This is the case pass 2 exists for.
    assert.deepEqual(hunkAdvice(mk("c.ts", [0.89, 0.2, 0.08, 0.04]), ["c.ts"]), []);
  });

  test("does not fire on a file with too few hunks to judge", () => {
    assert.deepEqual(hunkAdvice(mk("d.ts", [0.9, 0.8]), ["d.ts"]), []);
  });
});

// ---------------------------------------------------------------------------
// Orchestration and CLI.
//
// These were the untested half: every crash and every wrong exit code the review found lived
// below the pure functions above. The seam is `fetchImpl`, threaded from main() down to
// decide(), so nothing here touches the network or a global.
// ---------------------------------------------------------------------------

const ENV = { JEV_TRIAGE_KEY: "k", JEV_TRIAGE_API_BASE: "https://x" };

/** Run main() with stdout/stderr captured, so an exit code can be asserted without a child. */
async function runMain(argv, { env = ENV, fetchImpl } = {}) {
  const out = [], err = [];
  const so = process.stdout.write.bind(process.stdout);
  const se = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  process.stderr.write = (s) => { err.push(String(s)); return true; };
  try {
    const code = await main(argv, env, { fetchImpl });
    return { code, out: out.join(""), err: err.join("") };
  } finally {
    process.stdout.write = so;
    process.stderr.write = se;
  }
}

function tmpRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), "jev-test-"));
  for (const [name, body] of Object.entries(files)) {
    const p = join(dir, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return dir;
}

describe("scoreOf", () => {
  test("extracts a finite score", () => {
    assert.equal(scoreOf({ hit: { noul: 0.42 } }), 0.42);
    assert.equal(scoreOf({ hit: { noul: 0 } }), 0, "zero is a real score, not a missing one");
  });

  test("rejects every shape that is not a usable number", () => {
    for (const bad of [undefined, null, {}, { hit: {} }, { hit: { noul: "0.4" } }, { hit: { noul: NaN } }]) {
      assert.equal(scoreOf(bad), null, `${JSON.stringify(bad)} must not be treated as a score`);
    }
  });
});

describe("runSweep error paths", () => {
  const TMP = tmpRepo({ "a.ts": "export const a = 1;\n", "b.ts": "export const b = 2;\n" });
  const files = [join(TMP, "a.ts"), join(TMP, "b.ts")];

  test("a malformed response fails one candidate, never the whole sweep", async () => {
    // The bug this replaced: an unguarded r.answers.hit.noul threw out of mapPool's Promise.all,
    // discarding every other row — including ones already paid for.
    let n = 0;
    const fetchImpl = async () => {
      const body = n++ === 0 ? { unexpected: true } : okBody;
      return { ok: true, status: 200, json: async () => body };
    };
    const { rows } = await runSweep(files, "q", CFG, { concurrency: 1, fetchImpl });
    assert.equal(rows.filter((r) => r.ok).length, 1, "the good candidate must survive");
    assert.equal(rows.find((r) => !r.ok).error, "unexpected response shape");
  });

  test("an unparseable body is reported, not thrown", async () => {
    const fetchImpl = async () => ({
      ok: true, status: 200,
      json: async () => { throw new SyntaxError("Unexpected token < in JSON"); },
    });
    const { rows } = await runSweep(files, "q", CFG, { concurrency: 2, fetchImpl });
    assert.equal(rows.filter((r) => r.ok).length, 0);
    assert.ok(rows.every((r) => r.error === "unparseable response body"));
  });

  test("an unreadable file is one failed row", async () => {
    const { rows } = await runSweep([join(TMP, "gone.ts")], "q", CFG,
      { concurrency: 1, fetchImpl: stub([{ status: 200 }]) });
    assert.equal(rows[0].ok, false);
    assert.match(rows[0].error, /unreadable: ENOENT/);
  });

  test("a fatal status still aborts the run", async () => {
    await assert.rejects(
      () => runSweep(files, "q", CFG, { concurrency: 1, fetchImpl: stub([{ status: 401 }]) }),
      FatalApiError,
      "a bad key would fail every candidate; reporting them one by one buries the cause",
    );
  });

  test("runHunks guards the same shape", async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ answers: {} }) });
    const { rows } = await runHunks([join(TMP, "a.ts")], "q", CFG,
      { concurrency: 1, size: 40, overlap: 0.25, fetchImpl });
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => !r.ok && r.error === "unexpected response shape"));
  });
});

describe("main exit codes", () => {
  // The README documents these as a contract. Before this suite nothing enforced them.
  const TMP = tmpRepo({ "src/a.ts": "export const a = 1;\n" });

  test("0 when every candidate classifies", async () => {
    const r = await runMain(["sweep", "--dir", TMP, "--ext", ".ts", "--question", "q"],
      { fetchImpl: stub([{ status: 200 }]) });
    assert.equal(r.code, 0);
    assert.match(r.out, /a\.ts/);
  });

  test("1 when the run completed but something did not classify", async () => {
    const r = await runMain(["sweep", "--dir", TMP, "--ext", ".ts", "--question", "q"],
      { fetchImpl: stub([{ status: 400 }]) });
    assert.equal(r.code, 1);
    assert.match(r.out, /NOT CLASSIFIED/);
    assert.match(r.out, /absence here is not a low score/);
  });

  test("2 when configuration is missing, and the key is never echoed", async () => {
    const r = await runMain(["sweep", "--dir", TMP, "--question", "q"], { env: {} });
    assert.equal(r.code, 2);
    assert.match(r.err, /JEV_TRIAGE_KEY/);
    assert.ok(!r.err.includes("secret-key"));
  });

  test("2 on an empty candidate set — usage, not a partial result", async () => {
    const empty = tmpRepo({});
    const r = await runMain(["sweep", "--dir", empty, "--ext", ".ts", "--question", "q"],
      { fetchImpl: stub([{ status: 200 }]) });
    assert.equal(r.code, 2, "1 means 'completed with failures'; an empty sweep completed nothing");
  });

  test("2 on bad usage", async () => {
    assert.equal((await runMain(["frobnicate"])).code, 2);
    assert.equal((await runMain(["sweep", "--dir", TMP])).code, 2, "no question");
    assert.equal((await runMain(["hunks", "--question", "q"])).code, 2, "no --file");
    assert.equal((await runMain(["sweep", "--dir", TMP, "--pattern", "nope", "--subject", "s"])).code, 2);
  });

  test("3 on a fatal API error", async () => {
    const r = await runMain(["sweep", "--dir", TMP, "--ext", ".ts", "--question", "q"],
      { fetchImpl: stub([{ status: 402 }]) });
    assert.equal(r.code, 3);
    assert.match(r.err, /out of credit/);
  });

  test("help and patterns are always 0", async () => {
    assert.equal((await runMain([])).code, 0);
    assert.equal((await runMain(["--help"])).code, 0);
    const p = await runMain(["patterns"]);
    assert.equal(p.code, 0);
    assert.match(p.out, /implements-vs-references/);
  });
});

describe("main CLI surface", () => {
  const TMP = tmpRepo({
    "src/a.ts": Array.from({ length: 90 }, (_, i) => `const x${i} = ${i};\n`).join(""),
    "src/b.ts": "export const b = 2;\n",
  });

  test("--json emits a parseable document rather than the table", async () => {
    const r = await runMain(["sweep", "--dir", TMP, "--ext", ".ts", "--question", "q", "--json"],
      { fetchImpl: stub([{ status: 200 }]) });
    const doc = JSON.parse(r.out);
    assert.equal(doc.question, "q");
    assert.equal(doc.rows.length, 2);
    assert.equal(doc.failures, 0);
    assert.ok(typeof doc.cost === "number");
  });

  test("--json returns 0 even with failures, because the caller can see them", async () => {
    const r = await runMain(["sweep", "--dir", TMP, "--ext", ".ts", "--question", "q", "--json"],
      { fetchImpl: stub([{ status: 400 }]) });
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).failures, 2);
  });

  test("--drill runs a second pass and prints runnable sed commands", async () => {
    const r = await runMain(
      ["sweep", "--dir", TMP, "--ext", ".ts", "--question", "q", "--drill", "1"],
      { fetchImpl: stub([{ status: 200 }]) });
    assert.equal(r.code, 0);
    assert.match(r.out, /pass 2: hunks within the top 1/);
    assert.match(r.out, /sed -n '\d+,\d+p'/);
  });

  test("--top and --all control how much of the ranking is shown", async () => {
    const one = await runMain(["sweep", "--dir", TMP, "--ext", ".ts", "--question", "q", "--top", "1"],
      { fetchImpl: stub([{ status: 200 }]) });
    assert.match(one.out, /next below the cut/, "a hidden row must still be named");
    const all = await runMain(["sweep", "--dir", TMP, "--ext", ".ts", "--question", "q", "--all"],
      { fetchImpl: stub([{ status: 200 }]) });
    assert.ok(!/next below the cut/.test(all.out), "nothing is below the cut when everything is shown");
  });

  test("hunks reports which file could not be localised", async () => {
    const r = await runMain(
      ["hunks", "--file", join(TMP, "src/a.ts"), "--question", "q"],
      { fetchImpl: stub([{ status: 200, body: { answers: { hit: { noul: 0.01 } }, usage: {} } }]) });
    assert.equal(r.code, 0);
    assert.match(r.out, /no hunk localised/);
  });
});

describe("walk", () => {
  const TMP = tmpRepo({
    "src/a.ts": "a", "src/deep/b.tsx": "b", "src/c.js": "c",
    "node_modules/pkg/d.ts": "d", "dist/e.ts": "e", ".hidden/f.ts": "f",
  });

  test("filters by extension and returns sorted paths", () => {
    const got = walk(TMP, [".ts", ".tsx"]).map((p) => relative(TMP, p));
    assert.deepEqual(got, [join("src", "a.ts"), join("src", "deep", "b.tsx")]);
  });

  test("skips build and vendor directories, and dotted ones", () => {
    const all = walk(TMP, []).map((p) => relative(TMP, p));
    assert.ok(!all.some((p) => p.includes("node_modules")), "node_modules must never be swept");
    assert.ok(!all.some((p) => p.includes("dist")), "build output is not source");
    assert.ok(!all.some((p) => p.includes(".hidden")), "dotted directories are skipped");
    assert.ok(all.includes(join("src", "c.js")), "an empty extension list means every file");
  });

  test("a missing directory is empty, not a throw", () => {
    assert.deepEqual(walk(join(TMP, "nope"), [".ts"]), []);
  });
});

describe("the CLI as a process", () => {
  // The one path main() cannot be handed directly: stdin. Worth a real child process and a real
  // socket, because `grep -rl … | jev.mjs sweep --files -` is the documented entry point.
  test("reads candidates from stdin and exits 0", async () => {
    const server = createServer((req, res) => {
      const body = [];
      req.on("data", (c) => body.push(c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(okBody));
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const TMP = tmpRepo({ "a.ts": "export const a = 1;\n" });

    try {
      const child = spawn(process.execPath, [join(HERE, "..", "scripts", "jev.mjs"),
        "sweep", "--files", "-", "--question", "q"], {
        env: { ...process.env, JEV_TRIAGE_KEY: "k", JEV_TRIAGE_API_BASE: `http://127.0.0.1:${port}` },
      });
      const out = [];
      child.stdout.on("data", (c) => out.push(c));
      child.stdin.end(`${join(TMP, "a.ts")}\n`);
      const code = await new Promise((r) => child.on("close", r));
      assert.equal(code, 0);
      assert.match(Buffer.concat(out).toString(), /a\.ts/);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
