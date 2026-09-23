# jev-triage

A context firewall for coding agents.

Ask one precise question about every file in a repo, concurrently, for pennies. Read the six that
survive instead of the sixty that matched a grep.

It wraps [Jev](https://pi.dev) — TypeSafe's "System One" decision model — which returns typed
values and calibrated probabilities rather than prose. One skill directory, working in any agent
that reads `SKILL.md` — **Claude Code** and **Pi** are both tested.

Needs Node 20 or newer, and an API key.

## Why

The bottleneck in agent work isn't making decisions; it's *looking at things*. Every file read
costs context, and context is what forces subagent fan-out and degrades long sessions. Today,
deciding whether a file is worth reading requires reading it.

Run against a real TypeScript repo, asking "where is spectral analysis computed?", it returned
two files where a grep returned dozens — in seconds, for a couple of pence. More usefully it
stepped over all three traps the grep fell into: two files *named* after spectra that only render
them, and a file named `dsp.ts` that merely consumes a spectrum computed elsewhere.

(Those runs were against a private repo, so the figures are not reproducible here and are
deliberately left vague. `examples/live-check.mjs` is how you establish the same thing on a
codebase you know.)

## Install

The repo-root installer symlinks every skill into the agents it finds:

```sh
git clone https://github.com/elbeanio/skills.git
sh skills/install.sh          # symlink all skills into the agents installed here
sh skills/install.sh --check  # verify
```

Or link this one by hand, into whichever agent you use:

```sh
ln -s "$PWD/skills/jev-triage" ~/.claude/skills/jev-triage
ln -s "$PWD/skills/jev-triage" ~/.pi/agent/skills/jev-triage
```

Symlinks, so a `git pull` updates every agent at once and there's no copy to drift.

```sh
export JEV_TRIAGE_KEY=...
export JEV_TRIAGE_API_BASE=https://openrouter.ai/api/alpha/decisions
```

### What you are sending, and to whom

**Every file it sweeps is uploaded in full to a third-party API.** There is no local mode. Decide
whether that is acceptable for a given repo *before* pointing it at one — private or client code,
anything under an NDA, anything holding credentials or personal data.

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

Exit codes: `0` success, `1` completed with some candidates unclassified, `2` bad usage or config
(including an empty candidate set), `3` fatal API error (auth, credit).

A malformed or unparseable response fails that one candidate and is reported as NOT CLASSIFIED —
it never takes the rest of the sweep down with it.

## Keeping a record

```sh
export JEV_TRIAGE_LOG=~/.jev-triage/runs.jsonl   # opt-in; nothing is written without it
jev.mjs log                                      # last 20 runs, and what they cost
jev.mjs log --limit 100
```

Each run appends one JSON line: when, where, the question, the band counts, the cost, and the
top three results. That last part is the point — weeks later you can read a question back
alongside the files it chose and judge whether it was right, which is not a thing you can
reconstruct from a vague memory of it feeling useful.

It is opt-in because a tool that writes to your home directory uninvited is a rude thing to hand
someone. Log failures are swallowed: the sweep has already been paid for, and losing its result
to a logging problem would be an absurd trade.

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
- **Files that look like an attack payload.** Every candidate's contents travel to the API as a
  POST body, and an edge firewall inspects them: a file containing `javascript:`, an XSS or SQL
  fixture, a CSP config or a link sanitiser can come back `403` and never be ranked. It is
  reported as NOT CLASSIFIED rather than scored zero, but the blind spot lands precisely on
  security-related code — often the code you were searching for. Nothing to be done about it from
  this side; know that it happens and read those files yourself.
- **Being right about any single file.** It is right about the *shape* of a codebase far more often
  than about one file. Scores also move between runs: a repeated sweep shifted a file from 0.48 to
  0.62 and swapped the top two. **Ordering and gaps are stable; absolute values are not.**

It ranks and never filters, prints band counts and the rows below the cut, and names anything it
failed to classify — because a silently dropped candidate raises your confidence while lowering
your accuracy.

## Tests

```sh
node --test tests/*.test.mjs    # from inside jev-triage/ — offline, no key, the commit gate
```

No network and no key: the HTTP call is injected, so the suite covers the orchestration and the
CLI as well as the pure functions — including that a malformed response costs one candidate
rather than the run, and that the exit codes above are what they say they are. CI runs exactly
this on Node 20 and 22.

(Unquoted: the shell expands the glob. Node 20 cannot expand one itself, and Node 24+ no longer
searches a bare directory, so letting the shell do it is the form that works on both.)

### Checking the ranking on real code

The offline suite proves the plumbing, not the quality of the ranking. For that, point
`examples/live-check.mjs` at a repo you know well:

```sh
cp examples/live-check.example.json mine.local.json   # edit: repo, question, expectations
node examples/live-check.mjs --config mine.local.json
node examples/live-check.mjs --config mine.local.json --repo ../other-repo
```

It needs a key and spends real money, so it is a hand-run check rather than a gate. **Establish
the expectations by reading the code first** — ground truth copied from the tool's own output
proves only that the tool agrees with itself — and don't relax them to make a change pass. Configs
matching `*.local.json` are gitignored, because they name repos only you have.
