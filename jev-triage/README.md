# jev-triage

A context firewall for coding agents.

Ask one precise question about every file in a repo, concurrently, for about two pence. Read the
six that survive instead of the sixty that matched a grep.

It wraps [Jev](https://pi.dev) — TypeSafe's "System One" decision model — which returns typed
values and calibrated probabilities rather than prose. One skill directory, working in both
**Claude Code** and **Pi**.

## Why

The bottleneck in agent work isn't making decisions; it's *looking at things*. Every file read
costs context, and context is what forces subagent fan-out and degrades long sessions. Today,
deciding whether a file is worth reading requires reading it.

Measured on a real 186-file TypeScript repo, asking "where is spectral analysis computed?":

| | wall | cost | files read |
|---|---|---|---|
| `grep` + read the plausible ones | minutes | — | 43 candidates, 36 of them wasted |
| `jev-triage sweep` | **3.8s** | **$0.021** | 2 |

It also stepped over all three traps a grep falls into — two files *named* after spectra that only
render them, and a file named `dsp.ts` that merely consumes a spectrum computed elsewhere.

## Install

```sh
git clone https://github.com/elbeanio/skills.git
sh skills/jev-triage/install.sh          # symlinks into ~/.claude/skills/ and ~/.pi/agent/skills/
sh skills/jev-triage/install.sh --check  # verify
```

Symlinks, so a `git pull` updates both harnesses and there's no copy to drift. To install by hand
like the other skills in this repo, link the folder into whichever harness you use:

```sh
ln -s "$PWD/skills/jev-triage" ~/.claude/skills/jev-triage
ln -s "$PWD/skills/jev-triage" ~/.pi/agent/skills/jev-triage
```

```sh
export JEV_TRIAGE_KEY=...
export JEV_TRIAGE_API_BASE=https://openrouter.ai/api/alpha/decisions
```

**Mint a dedicated key with its own low credit limit.** An OpenRouter key carries access to every
model on the platform; this tool only ever issues the decisions request shape and has no code path
to chat completions, but a scoped key bounds the damage if it leaks. The key is never logged or
echoed, including in error output.

### Backends

`JEV_TRIAGE_API_BASE` is the **full endpoint URL**, not a host — the backends differ by path:

| | URL | model (`JEV_TRIAGE_MODEL`) | context |
|---|---|---|---|
| OpenRouter | `https://openrouter.ai/api/alpha/decisions` | `typesafe/jev-1.13` (default) | 32k |
| TypeSafe | `https://api.typesafe.ai/v1/systemone` | `jev-latest` | 64k |

Chunking targets the 32k floor so it's safe on either. Any OpenAI-incompatible endpoint speaking
the same `{model, state, questions}` shape will work, including local inference.

## Use

```sh
# sweep a tree
jev.mjs sweep --dir src --ext .ts,.tsx --pattern implements-vs-references --subject "token refresh"

# filter an existing candidate list
grep -rl refresh src | jev.mjs sweep --files - --question "..."

# sweep, then localise within the top 5 — output is line-anchored
jev.mjs sweep --dir src --ext .ts --question "..." --drill 5
```

`--drill` and `hunks` print a ready-to-run `sed -n 'lo,hip' file` per result, so you read 40 lines
instead of 400.

Exit codes: `0` success, `1` completed with some candidates unclassified, `2` bad usage or config,
`3` fatal API error (auth, credit).

## What it is bad at

Established by testing, not guessed:

- **Logs and repetitive streams.** Tested against two real Cloudflare build failures and cut from
  scope. Near-identical error lines flatten the distribution until every chunk scores alike, and
  the useful question about a log ("what went wrong *first*") is relational — unanswerable by a
  classifier scoring one window in isolation. This is a tool for source.
- **Multi-hop questions.** It classifies one state at a time. "Which file calls the thing defined
  in that other one" needs reasoning across candidates; do that yourself.
- **Absence.** "Where is X *not* handled?" — a window cannot contain evidence of something that
  never happened.
- **Being right about any single file.** It is right about the *shape* of a codebase far more often
  than about one file. Scores also move between runs: a repeated sweep shifted a file from 0.48 to
  0.62 and swapped the top two. **Ordering and gaps are stable; absolute values are not.**

It ranks and never filters, prints band counts and the rows below the cut, and names anything it
failed to classify — because a silently dropped candidate raises your confidence while lowering
your accuracy.

## Tests

Run from inside `jev-triage/`:

```sh
node --test 'tests/*.test.mjs'                      # offline, no key needed — the commit gate
AUDIOVIZ=path/to/repo node tests/live_smoke.mjs     # live regression against known ground truth
```

The live smoke test encodes ground truth established by hand: the two pipeline files rank top-2,
all three grep traps stay below 0.05, the top hunk contains the known call site, and a consuming
file stays flat as a negative control. **Don't relax those to make a change pass.** It is written
against a specific repo, so it is a regression test for the author rather than a general suite.
