# Planning a whole project

Read this when the thing being planned is a **project** rather than a change:
several phases, standing conventions, often a design document written elsewhere
and handed over.

The loop in SKILL.md applies unchanged — small batches, several rounds, challenge
thin answers, offer the exits every round. What differs is what you produce and
what you push on.

Not an "init". A project earns this when its unknowns are resolved, which is
often several spikes in rather than on the first day. Never assume an empty
directory or a first run.

## You produce two things

**1. `PROJECT.md` in the project root.** The durable half: what the project is
for, what is explicitly not in it, the constraints it holds itself to, and any
term that means something specific here. It is background for every future
session, so it earns its length — a standing rule belongs here, an ordered list
of work does not.

**2. One plan per phase, in `plans/`.** The ordered half: what gets built, in
what order, each small enough to finish, test, and take direction on before the
next begins.

The split matters and is easy to get wrong. "We use X, we never do Y, this word
means this" is `PROJECT.md`. "First this, then that" is the phase plans. Holding
direction in both places gives two answers that can disagree.

### There is no plan for the project as a whole

The goal, the argument, the non-goals, the architecture, the list of phases — all
of that is `PROJECT.md`. A plan that restates it duplicates the direction,
describes work nobody can ever finish, and sits in `plans/` forever looking like
something still to do. Every plan you write is **one phase**. If you find
yourself writing a plan whose goal is the project's goal, that plan is
`PROJECT.md` and you have written it in the wrong place.

## Before writing PROJECT.md

If one already exists, **do not overwrite it.** Read it, and ask whether you are
adding to it or replacing it. Destroying someone's project document because they
wanted to see what this did is the worst outcome available here.

Same for `AGENTS.md` or `CLAUDE.md` — read them first. If they already say
something, don't contradict it and don't repeat it.

## What to push on, beyond the usual

A phase boundary in the wrong place is not a detail, it is the shape of the
project. Rotate these in alongside the questions in SKILL.md:

- Why these phases, in this order? What would go wrong if two were merged, or one
  were split?
- What will the **first** phase disprove that the later ones are assuming? Later
  phases are written against guesses; find the guess that will not hold.
- **Can each phase be verified on its own**, or does its acceptance test need
  something a later phase builds? That is a phase boundary in the wrong place and
  it is common — a milestone whose test needs the scoring code from two phases
  later cannot be finished when it is meant to be.
- What is out of scope for the **project**, not just for a phase?
- What is the project for, in a sentence, and who decides when it is done?

## Writing the phase plans

Same sections as SKILL.md, and the same rule about Verification being a runnable
command. Two things specific to phases:

- **Go deep on the first phase and let the later ones be sketches.** Later phases
  are written against assumptions the first will disprove, and a thin plan that
  reads as decided is worse than an honest outline.
- **Each phase's acceptance criteria are the goal; its Verification is the
  command that proves them.** If a phase has nothing runnable yet, say so and
  agree what to add — don't write the criteria under the Verification heading and
  move on.

## Finishing

Say what you wrote: the document, then each phase in order. Then offer to start
the first phase only. Don't start anything yourself, and if the user declines,
say plainly how to pick it up later — leaving them holding six plans with no idea
what happens next is the failure this is meant to remove.
