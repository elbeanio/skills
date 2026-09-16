---
name: orient
description: Get up to speed on a project at the start of a fresh session. Reads the README, roadmap and other project documents, checks them against actual git activity, and reports back what the project is, what appears to be next, and what is unclear. Use at the start of a new session in an unfamiliar or resumed project, or when the user asks you to get up to speed, read the docs, or say what you think the project is.
---

Orient yourself in this project and report back. Do this **once**, at the start of a
session — if you have already oriented in this conversation, don't repeat it.

## Read

Cheapest and most authoritative first. Skip what doesn't exist; don't hunt for
substitutes.

1. `README.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, `CONTRIBUTING.md`
2. `AGENTS.md` / `CLAUDE.md` — the instructions you are expected to follow
3. `docs/*.md`, and the most recent two or three files in `plans/`
4. `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` — what this is built with

Then check what the documents claim against what has actually been happening:

- `git log --oneline -15` — what has been worked on recently
- `git status --short` — what is in flight right now
- The test and build commands, and whether they currently pass if that is cheap to check

## Report back

Three sections, short. The whole thing should fit on a screen — this is a
comprehension check, not a briefing document.

**What this is.** Two or three sentences. Not a description of the tech stack:
what the project is *for*, and the one or two decisions that shape it. If there
is a stated goal or north star, name it in the project's own words.

**What's next.** Read this from the roadmap or plan documents. Do not invent
priorities or infer them from vibes. If the documents state an order, use it and
say where it came from. If they don't, say so rather than guessing.

**What I'm unsure about.** The most useful section. Gaps, contradictions,
anything you could not resolve. Specifically call out where the documents and
the git history disagree — a roadmap that says one thing while the last ten
commits did another is the single most valuable thing you can surface, and it is
invisible unless you look for it. If everything is consistent, say so briefly and
move on.

## Rules

- **Be specific enough to prove you read it.** "A TypeScript project using pnpm
  with a focus on modularity" is worthless — it could describe anything, it costs
  the user tokens, and it manufactures confidence you have not earned. Name the
  actual goal, the actual constraint, the actual half-finished thing.
- **Quote or reference where a claim came from** when it matters. "The roadmap's
  Now section lists X" beats "the next task is X".
- **Thin documentation is a finding, not a gap to paper over.** If there is no
  README and the roadmap is stale, say that plainly — it is more useful than a
  confident summary assembled from filenames.
- **Do not start work.** Report, then stop and wait. The user decides what
  happens next.
