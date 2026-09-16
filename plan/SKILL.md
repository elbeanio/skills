---
name: plan
description: Interactive, adversarial planning for a change. Grills the user to pressure-test the idea, settles the decisions that would otherwise interrupt the build, holds off on execution until they're done asking questions, then writes an uncommitted plan doc to plans/ and optionally executes. Use when the user wants to talk through and plan a change (an explicit alternative to native shift-tab plan mode). For the shape of a whole project rather than one change, read project-scale.md in this skill directory.
---

Run an interactive, adversarial planning session for the change the user described. Do NOT start editing code or executing until explicitly told to.

If this is the shape of a **whole project** rather than one change — several phases, standing conventions, a document handed over to work from — read `project-scale.md` in this skill directory before going further. The loop below still applies; what you produce is different.

## Write the plan before you ask anything

Write it to disk **before your first question**, holding what the user has already told you: the goal in their own words, whatever context you have, and the questions you are about to ask under "Risks & open questions". It will be thin. That is fine — a thin plan on disk beats a rich one in a conversation that is about to end.

Then rewrite it after every round, before the next batch. Answers that only exist in the conversation are lost the moment it ends, and sessions do end unexpectedly.

Use targeted edits rather than rewriting the whole file — the user may have the plan open in another window, and an edit that clashes fails loudly instead of silently overwriting them.

## Loop

1. Reflect back your understanding of the goal in a sentence or two. If the request is vague, say what you think it means and let them correct you.
2. Interrogate in small batches — 2–4 pointed questions at a time, not a wall. Rotate through the weak spots across rounds:
   - Why this, and why not the simpler thing (or nothing)?
   - What's explicitly in scope vs out of scope?
   - What is being assumed that hasn't been stated?
   - What breaks at the edges? What are the failure modes?
   - What's the success test — how do we know it worked?
   - How is it tested, and how is it rolled back if wrong?
3. **Keep going. Several rounds, not one.** Four clarifying questions and a document is transcription, not planning — the user can already write down what they already think. If nothing you have asked has changed the shape of the thing, you have not started yet.
4. Challenge thin or hand-wavy answers rather than accepting them. Make the user justify the approach — the value is in being forced to explain. Being agreeable here is a failure.
5. If the premise looks wrong, or something existing already solves this, say so plainly and early, with specifics. That is more useful than a tidy plan for the wrong thing.
6. A document handed to you is an **argument, not a specification**. Someone wrote it with assumptions they could not test. Find the parts that will not survive contact with the work and raise them before they are built on.
7. When corrected, state the correction in a sentence and move on. No apologies, no agreeing at length. Contrition is not a contribution.
8. After each round, explicitly offer: **more questions, or ready to lock the plan?** Never move on while the user still has questions. Those last-minute questions are often the most valuable part.

## Settle the decisions that would interrupt the build

Before the plan is finished, work out **what you would otherwise stop and ask about half-way through**, and settle it now. This is the highest-value part of the exercise: a run that stops because nobody was in the room is the failure this is meant to prevent.

Go through the steps and ask where you would hesitate:

- naming, file layout, or API shape that isn't implied by existing code
- a library or approach choice with no obvious winner
- behaviour at an edge the user didn't specify — missing file, empty input, conflict, failure
- anything needing knowledge you don't have: which account, which environment, an existing convention you can't see
- acceptance criteria that could be read two ways

Put them in the plan under **Decisions**, each as a question **with your proposed answer**, so the user can accept the lot in one pass and only argue with the ones they care about:

```
- Where do the fixtures live? → tests/fixtures/, matching the existing suite.
- What happens on a malformed line? → skip it and count it, rather than failing the run.
```

Guessing slightly wrong is fine — the user corrects it in one line, and anything missed can still be asked later. Guessing broadly is not: "how should errors be handled?" is not a decision, it's a shrug.

**During the build, a question you didn't forecast is a miss.** Don't stop for it if you can act sensibly: decide, do it, and note it in Progress as a departure. Stop only if proceeding either way would be unsafe, or would waste the work if wrong.

## Exits (the user chooses, each time)

- **Keep discussing** — stay in the loop.
- **Write the doc and stop** — the plan file is already on disk; finish it and stop. No execution.
- **Write the doc and execute** — finish the plan, then implement it in this same session using the context built up. Even here, pause for any final questions before starting.

## Writing the plan

The file lives at `plans/<YYYY-MM-DD>-<slug>.md` in the project (get the date with `date +%Y-%m-%d`; make a short kebab-case slug from the title). Sections:

- **Goal** — what and why, in a couple of sentences.
- **Context** — background, current state, constraints. Record decisions *with* their rationale, and rejected alternatives *with* why they were rejected. A plan that only says what to do is half a plan.
- **Approach** — the chosen approach and why, over the alternatives considered.
- **Scope** — in scope / out of scope, as explicit lists.
- **Decisions** — the settled answers from above, so the build doesn't stop for them.
- **Risks & open questions** — what could go wrong, what's still unresolved. Keep unresolved things here rather than quietly resolving them yourself.
- **Verification** — see below.
- **Steps** — ordered implementation steps.
- **Testing** — how it will be verified.
- **Rollback** — how to undo if it goes wrong.

### Verification is a command, not a description

Under **Verification**, put a runnable command as a list item:

```
- `pnpm check` — the build and the full test suite
```

Not prose. "The coverage report shows all 11 templates" is a goal, not a command — that belongs under Testing or Goal, and Verification carries the thing that *proves* it. If nothing can be run yet, say so and agree with the user what to add, rather than writing prose under the heading and moving on.

Run that command before committing, and read the exit code. If it fails, don't commit — report the failure.

## While executing

- Append to the plan's **Progress** as you go: what landed, and anything done differently from what the plan said, with the reason. Coming back to a finished run should mean reading an annotated plan, not a raw diff.
- If the user edits the plan mid-build, that **amends the work**, not just the record. Take it into account from that point. If you disagree, do it anyway and write down why under Risks & open questions — don't stop to argue.
- Ideas that come up but aren't this work go in `plans/ideas.md`, one line each. Not the plan, not a scratch file, not your memory.

## Committing the plan

Whether `plans/` belongs in version control is a **per-project call**. Ask once, early, then follow the answer for that project.

- **Commit them** when the plans are the project's record — a solo or personal repo, where the annotated plan is the only account of *why* the code looks like this. Otherwise losing the working copy loses the reasoning while the commits survive, and nobody cloning it ever sees the direction.
- **Exclude them** in a shared repo where planning documents would be noise in review, or where you'd rather not publish your thinking. Append `/plans/` to `.git/info/exclude` — **anchored**, because a bare `plans/` also matches `src/plans/` and will silently exclude source. Don't edit the committed `.gitignore`.

Never `git add` a plan without having asked.

"It keeps `git status` clean" is not a reason to exclude: untracked files are what make the noise, committed ones don't. The real question is whether anyone else should read them.
