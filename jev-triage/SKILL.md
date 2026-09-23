---
name: jev-triage
description: Rank a large set of source files (or hunks within a file) against one precise question, cheaply and concurrently, so only the survivors are read. Use when a candidate set would cost more than ~80KB to read directly — grep returning dozens of hits, an unfamiliar repo, "where is X implemented" — and the question can be answered from one file in isolation. Ranks rather than filters, and reports what fell below the cut. Not for logs, not for multi-hop questions, not for questions about absence.
---

# jev-triage

Scores every candidate against one question in parallel, so you read six files instead of sixty.
Each call costs a fraction of a cent and the whole sweep takes seconds.

The point is not that the decision is cheaper — it is that **looking is cheaper**. Context is the
scarce resource. This lets you examine 200 files without any of them entering your context.

## What leaves your machine

**Every candidate's full contents are uploaded to a third-party API** — one request per file, or
per hunk. That is how the ranking happens; there is no local mode.

Before sweeping anything, check that sending it to an external service is acceptable: a private
or client codebase, anything under an NDA, a repo holding credentials or personal data. This is a
question about the *content*, and it is separate from — and more important than — the question of
which key you use.

## When to use it

Both conditions, together:

1. **Reading the candidates directly would cost more than ~80KB (~20k tokens).** Check, don't
   guess: `wc -c $(grep -rl PATTERN src)`. Below that, just read them — the round trip isn't worth
   the ceremony.
2. **The question is answerable from one file in isolation.**

## When not to use it

- **Multi-hop questions.** "Which file calls the thing defined in that other one" needs reasoning
  across candidates; this scores one state at a time. Do that part yourself, or delegate to a
  subagent if your harness has one.
- **Absence questions.** "Where is X *not* handled?" — a window cannot contain evidence of
  something that never happened.
- **Logs and other repetitive streams.** Tested and failed: near-identical lines flatten the
  distribution until every chunk scores alike. This is for source.
- **Small candidate sets.** Under ~15 files, reading is simpler and you lose nothing.

## Writing the question

The phrasing does almost all the work. `"is this relevant?"` produces noise.

**Name the distinction explicitly.** The phrasing that works looks like:

> This code implements *token refresh* itself, rather than merely calling, importing, referencing,
> or displaying something else that does.

That clause after "rather than" is what separates the two files that matter from the thirty that
merely mention the term.

**Ask "what is this?", never "which came first?"** Relational questions — earliest, original, root
cause — are unanswerable by a classifier scoring one state in isolation, because the answer lives
outside the state.

Run `"$JEV" patterns` for five ready-made shapes; use `--pattern NAME --subject "..."`
rather than composing from scratch.

## Usage

The script lives inside this skill's own directory, and you will be running it from somewhere
else — so invoke it by absolute path. Set it once:

```sh
JEV=~/.claude/skills/jev-triage/scripts/jev.mjs   # or ~/.pi/agent/skills/jev-triage/..., or
                                                  # <project>/.claude/skills/jev-triage/...
```

```sh
# sweep a tree
"$JEV" sweep --dir src --ext .ts,.tsx \
  --pattern implements-vs-references --subject "audio spectral analysis"

# sweep specific candidates (e.g. grep output)
grep -rl spectral src | "$JEV" sweep --files - --question "..."

# sweep, then localise within the top 5 — output is line-anchored
"$JEV" sweep --dir src --ext .ts --question "..." --drill 5

# rank hunks within known files
"$JEV" hunks --file src/analysis/extractSignals.ts --question "..."
```

`--drill` and `hunks` print a ready-to-run `sed -n 'lo,hip' file` per result, so you read 40 lines
rather than 400.

## Reading the output

It **ranks; it does not filter.** Read from the top and stop when it stops paying.

- Band counts (`170 <0.05  13 0.05-0.20  0 0.20-0.45  2 >0.45`) show the shape. A clean gap means
  a confident separation. **A flat distribution with no peak above ~0.6 means the question is
  ill-posed for this codebase** — rewrite the question rather than reading harder.
- The rows just below the cut are named, so a drop is visible rather than silent.
- Anything that failed to classify is listed explicitly. **That is not the same as scoring low** —
  never treat an absent candidate as a rejected one.

**Scores are not stable between runs.** Repeating the same sweep moved a file from 0.48 to 0.62
and swapped the top two. What is stable is the **ordering and the gaps** — so compare candidates
against each other, never against a remembered number, and don't treat 0.62 as meaningfully
different from 0.48.

Scores are probabilities, not truth. It is right about the *shape* of a codebase far more often
than it is right about any single file.

## Setup

Needs Node 20 or newer, and two environment variables:

```sh
export JEV_TRIAGE_KEY=...
export JEV_TRIAGE_API_BASE=https://openrouter.ai/api/alpha/decisions
```

Mint a **dedicated** key with its own low credit limit rather than reusing a broad one. See
`README.md` in this directory for the alternative backends.

Exit codes: `0` success, `1` completed with some candidates unclassified, `2` bad usage or
config (including an empty candidate set), `3` fatal API error.
