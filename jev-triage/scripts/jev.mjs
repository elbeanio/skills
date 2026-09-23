#!/usr/bin/env node
// jev-triage — rank many candidates against one categorical question, cheaply and concurrently,
// so only the survivors reach an agent's context.
//
// Backend-agnostic: speaks the Jev "decisions" request shape ({model, state, questions}) to
// whatever full endpoint URL JEV_TRIAGE_API_BASE names. It has no code path to a chat-completions
// endpoint, so a broadly-scoped key cannot be spent on a frontier model through this tool.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

export const DEFAULT_MODEL = "typesafe/jev-1.13";

// Chunking defaults to the 32k-context floor (OpenRouter) so it is safe on either backend.
// TypeSafe native allows 64k; that headroom is deliberately left unused rather than guessed at
// from the URL.
//
// Source tokenises far denser than prose — roughly 3-3.5 chars/token against prose's ~4 — so the
// earlier 110k cap implied ~32-36k tokens and could overshoot the very window it was sized for.
export const MAX_STATE_CHARS = 90_000;
export const HUNK_LINES = 40;
export const HUNK_OVERLAP = 0.25;
export const CONCURRENCY = 40;

// ---------------------------------------------------------------------------
// Question patterns.
//
// Every pattern is CATEGORICAL ("what is this?"), never RELATIONAL ("which of these came
// first?"). Relational questions are unanswerable by a classifier scoring one state in
// isolation, because the answer depends on material outside that state. This was established
// empirically: relational root-cause questions over build-log chunks failed on real data.
// ---------------------------------------------------------------------------

export const PATTERNS = {
  "implements-vs-references": {
    blurb: "Implements it, vs merely calls/imports/mentions it.",
    q: (s) =>
      `This code implements ${s} itself, rather than merely calling, importing, referencing, ` +
      `or displaying something else that does.`,
  },
  "handles-vs-declares": {
    blurb: "Handles it at runtime, vs only declaring types/config for it.",
    q: (s) =>
      `This code actually handles or processes ${s} at runtime, rather than only declaring ` +
      `types, constants, configuration, interfaces, or documentation about it.`,
  },
  "produces-vs-consumes": {
    blurb: "Originates the data, vs consuming data produced elsewhere.",
    q: (s) =>
      `This code produces or originates ${s}, rather than consuming, transforming, storing, ` +
      `or presenting something obtained from elsewhere.`,
  },
  "entrypoint-for": {
    blurb: "Where the behaviour is entered, vs a helper further down.",
    q: (s) =>
      `This code is where ${s} is initiated or entered from — the place control enters this ` +
      `behaviour — rather than a helper invoked further down the call chain.`,
  },
  "tests-for": {
    blurb: "Tests exercising it, vs the implementation or adjacent tests.",
    q: (s) =>
      `This code contains tests that directly exercise ${s}, rather than the implementation of ` +
      `it, or tests of merely adjacent behaviour.`,
  },
};

export const ROLE_CRITERIA = {
  implements: "Implements or performs the subject itself.",
  consumes: "Uses or transforms something produced elsewhere.",
  displays: "Renders, formats, logs, or presents it.",
  declares: "Only declares types, constants, config, interfaces, or documentation about it.",
  tests: "Tests it.",
  unrelated: "Nothing to do with the subject.",
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Resolve config from the environment. Two dedicated vars, no fallbacks: a generic fallback
 * such as OPENROUTER_API_KEY would silently pick up whatever broad key happened to be set,
 * which is exactly the risk worth avoiding. The key is never logged, echoed, or included in
 * error output.
 */
export function resolveConfig(env) {
  const key = env.JEV_TRIAGE_KEY;
  const base = env.JEV_TRIAGE_API_BASE;
  const missing = [];
  if (!key) missing.push("JEV_TRIAGE_KEY");
  if (!base) missing.push("JEV_TRIAGE_API_BASE");
  if (missing.length) {
    return {
      error:
        `missing ${missing.join(" and ")}\n\n` +
        `  JEV_TRIAGE_KEY       your API key\n` +
        `  JEV_TRIAGE_API_BASE  the FULL endpoint URL, not a host. Backends differ by path:\n` +
        `                         OpenRouter  https://openrouter.ai/api/alpha/decisions\n` +
        `                         TypeSafe    https://api.typesafe.ai/v1/systemone\n` +
        `  JEV_TRIAGE_MODEL     optional; default ${DEFAULT_MODEL}\n\n` +
        `Mint a dedicated key with its own low credit limit rather than reusing a broad one.`,
    };
  }
  return { key, base, model: env.JEV_TRIAGE_MODEL || DEFAULT_MODEL };
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export class FatalApiError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}

/**
 * Classify an HTTP status. Fatal errors abort the whole run — if the key is bad or out of
 * credit, every candidate would fail, and reporting 186 individual failures buries the cause.
 * Retryable errors are per-candidate. 402 is never retried: retrying a spent key just burns
 * wall-clock to arrive at the same answer.
 */
export function classifyStatus(status) {
  if (status === 401) return { fatal: true, kind: "auth", msg: "authentication rejected — check JEV_TRIAGE_KEY" };
  if (status === 402) return { fatal: true, kind: "credit", msg: "out of credit — the API refused the request for payment reasons" };
  if (status === 429) return { fatal: false, retry: true, kind: "throttled", msg: "throttled by the API (429)" };
  if (status >= 500) return { fatal: false, retry: true, kind: "server", msg: `server error (${status})` };
  // Not retried: a 403 here is almost always an edge firewall objecting to the CONTENT of this
  // candidate — a sanitiser, a security test, an XSS fixture. That verdict is deterministic, so
  // three attempts and their backoff arrive at the same answer more slowly.
  if (status === 403) return { fatal: false, retry: false, kind: "forbidden", msg: "forbidden (403) — an edge firewall rejected this content; it will not pass on a retry" };
  return { fatal: false, retry: false, kind: "http", msg: `HTTP ${status}` };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function decide(state, questions, cfg, { fetchImpl = fetch, retries = 3 } = {}) {
  const body = JSON.stringify({ model: cfg.model, state, questions });
  let lastMsg = "unknown error";
  let throttled = false;
  for (let attempt = 0; attempt < retries; attempt++) {
    let res;
    try {
      res = await fetchImpl(cfg.base, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      lastMsg = `network: ${e.name === "TimeoutError" ? "timed out" : e.message}`;
      if (attempt < retries - 1) { await sleep(1000 * (attempt + 1)); continue; }
      return { ok: false, error: lastMsg };
    }
    if (res.ok) {
      // A 200 is not a promise of JSON: a proxy or WAF can return an HTML interstitial with a
      // success status. Failing this candidate beats throwing out of the whole pool.
      let json;
      try { json = await res.json(); } catch { return { ok: false, error: "unparseable response body", throttled }; }
      return { ok: true, answers: json?.answers, usage: json?.usage ?? {}, throttled };
    }
    const c = classifyStatus(res.status);
    if (c.fatal) throw new FatalApiError(c.msg, c.kind);
    lastMsg = c.msg;
    if (c.kind === "throttled") throttled = true;
    if (c.retry && attempt < retries - 1) { await sleep(1000 * (attempt + 1)); continue; }
    return { ok: false, error: lastMsg, throttled };
  }
  return { ok: false, error: lastMsg, throttled };
}

/** Bounded-concurrency map. Preserves input order in the results array. */
export async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/**
 * Split lines into overlapping windows. Overlap exists so that a relevant span landing on a
 * boundary still appears whole in a neighbouring chunk. Returns 1-based inclusive line ranges.
 */
export function chunkLines(lines, size = HUNK_LINES, overlap = HUNK_OVERLAP) {
  if (lines.length === 0) return [];
  const step = Math.max(1, Math.floor(size * (1 - overlap)));
  const out = [];
  for (let i = 0; i < lines.length; i += step) {
    const hi = Math.min(lines.length, i + size);
    out.push({ lo: i + 1, hi, text: lines.slice(i, hi).join("") });
    if (hi >= lines.length) break;
  }
  return out;
}

/** Truncate an oversized state to the context floor, marking the cut so it is never silent. */
export function capState(text) {
  if (text.length <= MAX_STATE_CHARS) return { text, truncated: false };
  return {
    text: text.slice(0, MAX_STATE_CHARS) + "\n\n[... truncated to fit context limit ...]",
    truncated: true,
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export function bands(values) {
  const edges = [0, 0.05, 0.2, 0.45, 1.01];
  const counts = new Array(edges.length - 1).fill(0);
  for (const v of values) {
    for (let i = 0; i < counts.length; i++) {
      if (v >= edges[i] && v < edges[i + 1]) { counts[i]++; break; }
    }
  }
  return [
    `${counts[0]} <0.05`,
    `${counts[1]} 0.05-0.20`,
    `${counts[2]} 0.20-0.45`,
    `${counts[3]} >0.45`,
  ].join("  ");
}

/**
 * Render ranked rows.
 *
 * Never filters: it ranks, shows a cut, and then explicitly names the highest-scoring rows that
 * fell below it. A dropped candidate is otherwise indistinguishable from one that scored low,
 * and a silent drop raises confidence while lowering accuracy.
 */
export function formatSweep(rows, { top = 10, all = false, failures = [], throttled = false } = {}) {
  const ok = rows.filter((r) => r.ok);
  ok.sort((a, b) => b.score - a.score);
  const shown = all ? ok : ok.slice(0, top);
  const lines = [];
  lines.push(`${"score".padStart(5)} ${"role".padStart(11)} ${"cf".padStart(4)}  candidate`);
  for (const r of shown) {
    lines.push(
      `${r.score.toFixed(2).padStart(5)} ${String(r.role ?? "").padStart(11)} ` +
        `${(r.conf ?? 0).toFixed(2).padStart(4)}  ${r.label}`,
    );
  }
  lines.push(`-- ${ok.length} ranked | ${bands(ok.map((r) => r.score))}`);
  const below = ok.slice(shown.length, shown.length + 3);
  if (below.length) {
    lines.push(`-- next below the cut: ${below.map((r) => `${r.label} (${r.score.toFixed(2)})`).join(", ")}`);
  }
  if (throttled) lines.push(`-- NOTE: throttled by the API during this run; results are complete but were slowed`);
  if (failures.length) {
    lines.push(`-- ${failures.length} NOT CLASSIFIED (absence here is not a low score):`);
    for (const f of failures.slice(0, 10)) lines.push(`     ${f.label}: ${f.error}`);
    if (failures.length > 10) lines.push(`     ... and ${failures.length - 10} more`);
  }
  return lines.join("\n");
}

/**
 * Per-file advice about whether localising inside it means anything.
 *
 * Pass 2 only helps when a file is heterogeneous. Two ways it isn't:
 *  - nothing scores  -> the file ranked high for reasons no single hunk carries; read it whole.
 *  - everything scores -> the whole file is on-subject; ranking within it is noise, read it whole.
 * Either way the honest answer is "read the file", and saying so beats presenting a top hunk
 * that is not actually special.
 */
export function hunkAdvice(rows, files) {
  const out = [];
  for (const f of files) {
    const mine = rows.filter((r) => r.ok && r.file === f);
    if (!mine.length) continue;
    const best = Math.max(...mine.map((r) => r.score));
    const high = mine.filter((r) => r.score > 0.45).length;
    if (best < 0.2) {
      // Provenance-neutral: in a --drill this file survived pass 1, but in a standalone `hunks`
      // run the caller named it, and it may simply be irrelevant. Both readings are useful.
      out.push(
        `${f}: no hunk localised (best ${best.toFixed(2)}) — read whole, or this file does not ` +
        `answer the question`,
      );
    } else if (mine.length > 2 && high / mine.length > 0.5) {
      out.push(
        `${f}: ${high}/${mine.length} hunks on-subject — the whole file is about this, ` +
        `ranking within it is not meaningful; read whole`,
      );
    }
  }
  return out;
}

export function formatHunks(rows, { top = 10 } = {}) {
  const ok = rows.filter((r) => r.ok);
  ok.sort((a, b) => b.score - a.score);
  const lines = [`${"score".padStart(5)}  location and how to read it`];
  for (const r of ok.slice(0, top)) {
    lines.push(
      `${r.score.toFixed(2).padStart(5)}  ${r.file}:${r.lo}-${r.hi}   sed -n '${r.lo},${r.hi}p' ${r.file}`,
    );
  }
  lines.push(`-- ${ok.length} hunks | ${bands(ok.map((r) => r.score))}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Run log
//
// Opt-in, because a tool that writes to someone's home directory uninvited is a rude thing to
// hand them. Set JEV_TRIAGE_LOG and every real run appends one JSON line: what was asked, what
// came back, what it cost. That is the material for judging later whether this was worth using —
// a question with its top hits is reviewable weeks afterwards in a way "it felt useful" is not.
// ---------------------------------------------------------------------------

export function resolveLogPath(env) {
  const p = env.JEV_TRIAGE_LOG;
  if (!p) return null;
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

/**
 * Append one run to the log. Never throws: the sweep has already been paid for, and losing its
 * result because a log line could not be written would be an absurd trade.
 */
export function logRun(env, entry) {
  const path = resolveLogPath(env);
  if (!path) return false;
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`);
    return true;
  } catch {
    return false;
  }
}

export function readLog(path, limit = 20) {
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  const runs = [];
  for (const l of lines) {
    // A truncated or hand-edited line is skipped rather than aborting the report.
    try { runs.push(JSON.parse(l)); } catch { /* ignore */ }
  }
  return { runs: runs.slice(-limit), total: runs.length, spend: runs.reduce((s, r) => s + (r.cost ?? 0), 0) };
}

export function formatLog({ runs, total, spend }) {
  const out = [];
  for (const r of runs) {
    const when = (r.ts ?? "").replace("T", " ").slice(0, 16);
    const where = (r.cwd ?? "").replace(homedir(), "~");
    out.push(`${when}  ${where}`);
    out.push(`  ${r.cmd} ${r.candidates} candidates | ${r.wall}s | $${(r.cost ?? 0).toFixed(4)}` +
      `${r.failures ? ` | ${r.failures} unclassified` : ""}${r.bands ? ` | ${r.bands}` : ""}`);
    if (r.question) out.push(`  "${r.question.slice(0, 96)}${r.question.length > 96 ? "…" : ""}"`);
    for (const [label, score] of r.top ?? []) out.push(`    ${score.toFixed(2)}  ${label}`);
    out.push("");
  }
  out.push(`-- ${runs.length} of ${total} runs | $${spend.toFixed(4)} spent in total`);
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "vendor", "__pycache__", ".venv"]);

export function walk(root, exts) {
  const out = [];
  const rec = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) rec(p); }
      else if (e.isFile()) {
        if (!exts.length || exts.some((x) => e.name.endsWith(x))) out.push(p);
      }
    }
  };
  rec(root);
  return out.sort();
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

export function resolveQuestion({ question, pattern, subject }) {
  if (question) {
    return question.startsWith("@") ? readFileSync(question.slice(1), "utf8").trim() : question;
  }
  if (pattern) {
    const p = PATTERNS[pattern];
    if (!p) throw new Error(`unknown pattern '${pattern}'. Known: ${Object.keys(PATTERNS).join(", ")}`);
    if (!subject) throw new Error(`--pattern needs --subject (e.g. --subject "audio spectral analysis")`);
    return p.q(subject);
  }
  throw new Error("need --question, or --pattern with --subject");
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function questionsFor(text, withRole) {
  const q = { hit: { type: "noul", instructions: text } };
  if (withRole) {
    // The role question must be self-contained. An earlier version said "the subject of the
    // question" without restating it, and the label flipped between runs — a renderer came back
    // `implements` because it does implement *something*, just not the subject. Interpolating
    // the claim removes the ambiguity.
    q.role = {
      type: "choice",
      instructions:
        `Consider this claim about the code: "${text}"\n\n` +
        `What is the code's actual relationship to the specific subject of that claim?`,
      criteria: ROLE_CRITERIA,
    };
  }
  return q;
}

/**
 * Pull the score out of a response, or say why it could not be used.
 *
 * The shape is the backend's to change, and one unexpected body must never cost the whole run:
 * every candidate here has already been paid for. A bad shape fails one row, like any other
 * per-candidate error, and is reported as NOT CLASSIFIED rather than as a low score.
 */
export function scoreOf(answers) {
  const v = answers?.hit?.noul;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function runSweep(files, questionText, cfg, opts) {
  const qs = questionsFor(questionText, !opts.noRole);
  let throttled = false;
  const rows = await mapPool(files, opts.concurrency, async (file) => {
    let raw;
    try { raw = readFileSync(file, "utf8"); } catch (e) { return { ok: false, label: file, error: `unreadable: ${e.code ?? e.message}` }; }
    const { text } = capState(`${file}\n\n${raw}`);
    const r = await decide(text, qs, cfg, { fetchImpl: opts.fetchImpl });
    if (r.throttled) throttled = true;
    if (!r.ok) return { ok: false, label: file, error: r.error };
    const score = scoreOf(r.answers);
    if (score === null) return { ok: false, label: file, error: "unexpected response shape" };
    return {
      ok: true,
      label: file,
      score,
      role: r.answers.role?.choice,
      conf: r.answers.role?.confidence,
      cost: r.usage.cost ?? 0,
      tokens: r.usage.input_tokens ?? 0,
    };
  });
  return { rows, throttled };
}

export async function runHunks(files, questionText, cfg, opts) {
  const jobs = [];
  for (const f of files) {
    let raw;
    try { raw = readFileSync(f, "utf8"); } catch { continue; }
    for (const c of chunkLines(raw.split(/(?<=\n)/), opts.size, opts.overlap)) {
      jobs.push({ file: f, ...c });
    }
  }
  const qs = questionsFor(questionText, false);
  let throttled = false;
  const rows = await mapPool(jobs, opts.concurrency, async (j) => {
    const { text } = capState(`${j.file} lines ${j.lo}-${j.hi}:\n\n${j.text}`);
    const r = await decide(text, qs, cfg, { fetchImpl: opts.fetchImpl });
    if (r.throttled) throttled = true;
    if (!r.ok) return { ok: false, label: `${j.file}:${j.lo}-${j.hi}`, error: r.error };
    const score = scoreOf(r.answers);
    if (score === null) return { ok: false, label: `${j.file}:${j.lo}-${j.hi}`, error: "unexpected response shape" };
    return { ok: true, file: j.file, lo: j.lo, hi: j.hi, score, cost: r.usage.cost ?? 0 };
  });
  return { rows, throttled };
}

const HELP = `jev-triage — rank many candidates against one categorical question.

  Ask "what is this?", never "which of these came first?". Relational questions (earliest,
  original, root cause) cannot be answered by scoring one state in isolation.

USAGE
  jev.mjs sweep  [--dir D | --files -] [--ext .ts,.tsx] (--question Q | --pattern P --subject S)
                 [--drill N] [--top N] [--all] [--json]
  jev.mjs hunks  --file F [--file F ...] (--question Q | --pattern P --subject S)
                 [--size 40] [--overlap 0.25] [--top N] [--json]
  jev.mjs log    [--limit 20]
  jev.mjs patterns

WHEN TO USE IT
  When reading the candidate set directly would cost more than ~80KB (~20k tokens) — check with
  \`wc -c\` — AND the question is answerable from one file in isolation.
  Below that, just read the files; the round trip is not worth it.

WHEN NOT TO USE IT
  * Multi-hop questions ("which file calls the thing defined in that other one"). It classifies
    one state at a time; it cannot reason across candidates. Do that yourself, or delegate to a
    subagent if your harness has one.
  * Absence questions ("where is X NOT handled?"). A window cannot contain evidence of something
    that never happened.
  * Logs and other repetitive streams. Validated as a failure: near-identical lines flatten the
    distribution so every chunk scores alike. This tool is for source.

READING THE OUTPUT
  Ranks, never filters. Read from the top and stop when it stops paying. Band counts and the
  rows just below the cut are printed so a drop is visible rather than silent. Anything that
  failed to classify is named explicitly — that is not the same as scoring low.

ENVIRONMENT
  JEV_TRIAGE_KEY       API key (never logged).
  JEV_TRIAGE_API_BASE  FULL endpoint URL, not a host:
                         https://openrouter.ai/api/alpha/decisions   (OpenRouter)
                         https://api.typesafe.ai/v1/systemone        (TypeSafe native)
  JEV_TRIAGE_MODEL     optional; default ${DEFAULT_MODEL}
  JEV_TRIAGE_LOG       optional; append one JSON line per run here, and read it back with
                       \`jev.mjs log\`. Nothing is recorded unless this is set.
`;

export async function main(argv = process.argv.slice(2), env = process.env, { fetchImpl } = {}) {
  const cmd = argv[0];
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") { process.stdout.write(HELP); return 0; }

  if (cmd === "patterns") {
    for (const [name, p] of Object.entries(PATTERNS)) {
      process.stdout.write(`${name.padEnd(28)} ${p.blurb}\n`);
    }
    process.stdout.write(`\nAll patterns are categorical by design. Use with --subject.\n`);
    return 0;
  }

  if (cmd !== "sweep" && cmd !== "hunks" && cmd !== "log") {
    process.stderr.write(`unknown command '${cmd}'\n\n${HELP}`);
    return 2;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: argv.slice(1),
      options: {
        question: { type: "string" }, pattern: { type: "string" }, subject: { type: "string" },
        dir: { type: "string" }, ext: { type: "string" }, files: { type: "string" },
        file: { type: "string", multiple: true },
        top: { type: "string" }, all: { type: "boolean" }, json: { type: "boolean" },
        size: { type: "string" }, overlap: { type: "string" },
        drill: { type: "string" }, concurrency: { type: "string" }, "no-role": { type: "boolean" },
        limit: { type: "string" },
      },
      allowPositionals: false,
    });
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 2;
  }
  const a = parsed.values;

  // Reading the log needs no key and no endpoint — it is a local file.
  if (cmd === "log") {
    const path = resolveLogPath(env);
    if (!path) {
      process.stderr.write("jev-triage: JEV_TRIAGE_LOG is not set, so nothing has been logged.\n\n" +
        "  export JEV_TRIAGE_LOG=~/.jev-triage/runs.jsonl\n");
      return 2;
    }
    if (!existsSync(path)) { process.stdout.write(`no runs logged yet at ${path}\n`); return 0; }
    process.stdout.write(`${formatLog(readLog(path, a.limit ? Number(a.limit) : 20))}\n`);
    return 0;
  }

  const cfg = resolveConfig(env);
  if (cfg.error) { process.stderr.write(`jev-triage: ${cfg.error}\n`); return 2; }

  let questionText;
  try { questionText = resolveQuestion(a); } catch (e) { process.stderr.write(`jev-triage: ${e.message}\n`); return 2; }

  const opts = {
    top: a.top ? Number(a.top) : 10,
    all: !!a.all,
    size: a.size ? Number(a.size) : HUNK_LINES,
    overlap: a.overlap ? Number(a.overlap) : HUNK_OVERLAP,
    concurrency: a.concurrency ? Number(a.concurrency) : CONCURRENCY,
    noRole: !!a["no-role"],
    fetchImpl,
  };

  let files = [];
  if (cmd === "hunks") {
    files = a.file ?? [];
    if (!files.length) { process.stderr.write(`jev-triage: hunks needs --file\n`); return 2; }
  } else if (a.files === "-") {
    files = (await readStdin()).split("\n").map((s) => s.trim()).filter(Boolean);
  } else {
    const root = a.dir ?? ".";
    const exts = a.ext ? a.ext.split(",").map((s) => s.trim()).filter(Boolean) : [];
    files = walk(root, exts);
  }
  // Usage, not a partial result: 1 is reserved for a run that completed with some candidates
  // unclassified, and conflating the two makes the documented exit codes meaningless.
  if (!files.length) { process.stderr.write(`jev-triage: no candidates\n`); return 2; }

  const t0 = Date.now();
  let result;
  try {
    result = cmd === "sweep"
      ? await runSweep(files, questionText, cfg, opts)
      : await runHunks(files, questionText, cfg, opts);
  } catch (e) {
    if (e instanceof FatalApiError) { process.stderr.write(`jev-triage: ${e.message}\n`); return 3; }
    throw e;
  }

  const { rows, throttled } = result;
  const failures = rows.filter((r) => !r.ok);
  const cost = rows.reduce((s, r) => s + (r.cost ?? 0), 0);
  const wall = ((Date.now() - t0) / 1000).toFixed(1);

  if (a.json) {
    process.stdout.write(JSON.stringify({ question: questionText, rows, failures: failures.length, cost, wall }, null, 1) + "\n");
  } else if (cmd === "sweep") {
    process.stdout.write(formatSweep(rows, { ...opts, failures, throttled }) + "\n");
    process.stdout.write(`-- ${files.length} candidates | ${wall}s | $${cost.toFixed(4)}\n`);

    const drill = a.drill ? Number(a.drill) : 0;
    if (drill > 0) {
      const topFiles = rows.filter((r) => r.ok).sort((x, y) => y.score - x.score).slice(0, drill).map((r) => r.label);
      process.stdout.write(`\n-- pass 2: hunks within the top ${topFiles.length}\n`);
      const h = await runHunks(topFiles, questionText, cfg, opts);
      process.stdout.write(formatHunks(h.rows, opts) + "\n");
      // Pass 2 never eliminates a file: one that localises nowhere — or everywhere — is
      // reported as "read whole", not silently dropped or falsely narrowed.
      for (const line of hunkAdvice(h.rows, topFiles)) process.stdout.write(`-- ${line}\n`);
    }
  } else {
    process.stdout.write(formatHunks(rows, opts) + "\n");
    for (const line of hunkAdvice(rows, files)) process.stdout.write(`-- ${line}\n`);
    process.stdout.write(`-- ${rows.length} hunks | ${wall}s | $${cost.toFixed(4)}\n`);
  }

  const code = failures.length && !a.json ? 1 : 0;
  const ranked = rows.filter((r) => r.ok).sort((x, y) => y.score - x.score);
  logRun(env, {
    ts: new Date().toISOString(),
    cwd: process.cwd(),
    cmd,
    question: questionText,
    candidates: files.length,
    failures: failures.length,
    cost,
    wall: Number(wall),
    exit: code,
    bands: bands(ranked.map((r) => r.score)),
    top: ranked.slice(0, 3).map((r) => [r.label ?? `${r.file}:${r.lo}-${r.hi}`, r.score]),
  });
  return code;
}

// Both sides go through realpath before comparing. Skills are installed BY SYMLINK, so this
// file is normally reached through one — and Node reports import.meta.url as the resolved real
// path while argv[1] keeps the symlink it was invoked by. Comparing them raw means main() never
// runs: no output, no error, exit 0. Silent success is the worst failure available here.
const entry = process.argv[1];
let isMain = false;
try {
  isMain = !!entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
} catch { /* argv[1] gone or unreadable: treat as imported, not run */ }
if (isMain) {
  main().then((c) => process.exit(c)).catch((e) => { process.stderr.write(`jev-triage: ${e.stack}\n`); process.exit(3); });
}
