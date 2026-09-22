---
name: afk
description: Prepare to run unattended while the user steps away. Works out what's left to do, forecasts everything that would otherwise interrupt them — decisions, missing knowledge, permission prompts — asks it all in one batch before they go, then works the queue and leaves a catch-up summary. Use when the user says they're going AFK, stepping out, back in an hour, leaving it running, or asks you to carry on without them.
---

The user is about to stop watching. **Everything you would interrupt them for has to be asked
now, in one batch, before they go.** A run that stalls two minutes after they leave wastes the
whole window, and that is the failure this exists to prevent.

Ask how long they'll be gone if they didn't say. It sets what's worth starting — twenty minutes
and a whole afternoon are different jobs.

## 1. Work out what's left to do

Before asking anything. The answer is usually already written down somewhere; find it first.

- The current todo list or task queue
- The active plan in `plans/` — its **Steps** and **Progress**
- `git status --short` and `git log --oneline -5` — what's in flight
- The project's real test/build gate, and whether it passes *right now* — starting from a broken
  tree unattended is worth knowing about before they leave, not after
- Anything already running: dev server, watcher, a long job

**If there's a queue — todos, plan steps, an agreed list — that's the work.** Take it in order.
**If there isn't, ask what they want done.** Don't invent a project for yourself out of things
you noticed; unattended is exactly the wrong time for uninvited work.

## 2. Forecast the interruptions

Walk the work you're about to do and find every point you would stop. This is the whole
exercise, and it's the same move as the **Decisions** section in the `plan` skill — read it if
the work is large enough to warrant a plan.

- Naming, file layout, or API shape that isn't implied by existing code
- A library or approach choice with no obvious winner
- Behaviour at an edge nobody specified — missing file, empty input, conflict, failure
- Knowledge you don't have: which account, which environment, a convention you can't see
- Acceptance criteria that could be read two ways
- Anything you'd want a second opinion on before it's hard to undo

Put each one to them **with your proposed answer**, so they can accept the lot in one pass and
only argue with the ones they care about:

```
- Fixtures go in tests/fixtures/, matching the existing suite.
- Malformed line: skip it and count it, rather than failing the run.
```

### Permissions are the interruption that actually stops you

A prompt nobody is there to answer blocks the run completely, so forecast these specifically:

- Commands the work needs that aren't already allowed — a package install, a test runner, `gh`,
  a migration, an MCP tool
- Writes outside the project directory
- Anything the session has prompted for already, which will prompt again

**Name the actual calls.** "I might need some permissions" is not a forecast. Then ask them
either to approve those specific ones, or — if the list is long or you can't fully predict it —
say plainly that accept-edits or bypass-permissions mode suits this window better, and let them
choose. Their call, not yours.

## 3. Ask, once

One message before they go:

1. What you'll work on, in order, and what you expect to finish in the time
2. The decisions, with your proposed answers
3. The permissions or mode change you need
4. Anything you'd rather **not** do unattended, and why

Then confirm the agreed plan back in a line or two, and let them leave.

## While they're away

- **Decide, don't stall.** A question you failed to forecast is a miss — don't compound it by
  idling until they return. Act sensibly, and record it as a departure. Stop only if proceeding
  either way would be unsafe, or would waste the work if wrong.
- **Commit as you go.** Hours of unattended work sitting uncommitted is the bigger risk: it's
  lost to a crash, and it's a single unreviewable lump when they get back. Run the project's real
  gate first — if it fails, don't commit, and say so in the summary.
- **Don't push, deploy, or publish** unless they said so explicitly before leaving. Nothing
  outward-facing and nothing hard to undo, even where the permission was granted. An unattended
  agent is the worst possible author of an irreversible action.
- **Stay inside what was agreed.** New ideas go on a list for when they're back, not into the
  tree. `plans/ideas.md` if the project has one.
- **Leave the tree walkable.** No half-applied refactor, no debug logging, no scratch files. Stop
  early enough to finish cleanly rather than being caught mid-change.
- **If you're blocked, don't thrash.** Move to the next thing on the list, or stop and write up
  the block. Three failing attempts at the same wall is the signal to leave it.

## The catch-up

Wrap up the way the project expects, then leave a summary as your last message. Three short
sections — they're catching up, not being briefed, so keep the whole thing to a screen:

- **Done** — what landed, with commit hashes. Say whether the gate passed.
- **Next** — where you stopped and what the next step is, so they can pick it up cold.
- **Unexpected** — decisions you made on their behalf, departures from the agreed plan, anything
  that broke, anything still blocked. **The most valuable section.** A decision taken in their
  absence that they never get told about is the thing that bites later; don't bury it at the
  bottom of a list of successes.

## Rules

- **AFK is not permission to be bolder.** Same standards, same care, same gate — the only
  difference is that the questions were asked up front instead of as you went.
- **Scale the ambition to the window.** Pick work that reaches a clean stopping point in the time
  you have. A finished small thing beats two-thirds of a big one.
- **Never downgrade the gate** to keep moving — no skipped tests, no `--no-verify`, no lighter
  proxy for the real build.
- **If there is genuinely nothing safe to do unattended, say so before they go.** Offer what you
  could do instead. That's a better outcome than an hour of work nobody wanted.
