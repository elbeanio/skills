---
name: glossary
description: Write, wire in, and keep current a project's GLOSSARY.md — the locked vocabulary used in the UI, the code, and the docs. Use when the user asks for a glossary, a terminology doc, or locked/shared vocabulary; when naming is drifting (the same thing called three things, or one word meaning two things); or when a feature has shipped names that the glossary doesn't cover yet.
---

Build or maintain a project's **glossary**: one page naming every concept the project has, so
the UI, the code, the docs and the conversation all use the same word for the same thing.

A glossary is worth having when a project has invented concepts — things with no obvious
outside name, or ordinary words used in a specific way. It is not worth having for a project
whose nouns are all standard (a CRUD app whose entities are User, Order, Invoice). Say so and
stop, rather than producing a page that defines "user" as "a user".

Two modes. Work out which from what the user asked:

- **Create** — no glossary exists. Gather evidence, interrogate, write, wire in.
- **Audit** — one exists. Check it against what the code and UI actually say, and fix the drift.

---

## Create

### 1. Gather the evidence before asking anything

Do not open with questions. The project already contains most of its vocabulary; find it, then
ask about what's genuinely ambiguous. The user's time is for the judgment calls.

Read, cheapest first:

1. `README.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `DESIGN.md`, `CLAUDE.md` / `AGENTS.md`
2. The type definitions — `types.ts`, `models.py`, schema files, the core domain module. Named
   types and enum members *are* the vocabulary, whether or not anyone wrote it down.
3. The UI strings — labels, headings, nav items, menu entries. These are what the user actually
   reads, and where a project most often contradicts itself.
4. The directory names under `src/`, and the recent commit subjects.

Then assemble two lists:

- **Concepts** — every noun the project has invented or bent. Screens, entities, roles, pipeline
  stages, file kinds, modes.
- **Collisions** — the real work. Look specifically for:
  - one word used for two things (`config` meaning both the file and the runtime object)
  - two words used for one thing (`section` in the analysis code, `scene` in the UI)
  - a code name and a UI name that differ (find these by diffing list 2 against list 3)
  - a word with a strong outside meaning being used loosely (`render`, `session`, `job`, `event`)

### 2. Interrogate, in small batches

2–4 questions at a time, aimed at the collisions. Bring your evidence — "the store calls this a
`section` and the timeline UI calls it a scene; are those one concept or two?" beats "what
should we call this?". The user knows which distinctions matter; you know where the code
disagrees with itself.

For each collision, drive to one of three outcomes and record which:

- **Unify** — same concept, pick the winning word, the other becomes an alias to be renamed out.
- **Distinguish** — genuinely two concepts; then the glossary must say *how they differ*, in the
  entry for both.
- **Reserve** — the word is claimed for one meaning and banned for the other ("render is the
  offline export, never the live preview").

Also settle: British or American spelling (`colour`/`color`), singular or plural for entity
names, and whether internal code names are allowed to differ from user-facing ones.

Keep going until the collisions are settled. Then write.

### 3. Write it

`GLOSSARY.md` at the repo root, next to the README — it's for humans as much as for you.

**Open with a paragraph that uses the terms in a sentence**, describing what the project does.
This is the single most useful part of the page: it teaches the shape of the thing and the words
at the same time, and it exposes a vocabulary that doesn't hang together, because you won't be
able to write the sentence.

> The app is a node-graph workbench: you load a **track**, split it into **scenes**, and on each
> scene wire the track's **signals** into a **visualisation** and a chain of **FX**, then
> **export** the result to a video.

**Group by domain, never alphabetically.** Alphabetical order scatters concepts that only make
sense next to each other. Six to ten `##` sections, each a part of the system, ordered the way a
newcomer would meet them. A section per screen/surface at the end is usually worth it.

**Each entry: bold term, em dash, definition.** One or two sentences. Cross-link other glossary
terms in **bold** inside definitions — that's what turns a list into a map.

```markdown
- **Scene** — a stretch of the **timeline**: a name, a colour, the **transition** into it, and a
  node **graph**. The timeline is a sequence of scenes.
- **Section** — the same thing as a scene, seen from the analysis side. "Section" and "scene" are
  unified — a track is always covered by ≥1 scene.
```

Then the rules that make it bind rather than decorate:

- **Define confusable terms against each other, explicitly.** An entry that doesn't mention the
  thing it's most often confused with has done nothing. Name the neighbour and state the
  difference in the same breath: *"Distinct from Analysis: a Profile is advisory — it never
  touches the render."*
- **Say what a word is *not*.** Reserved words earn a clause: *("Render" is reserved for this —
  not the live preview.)* Bans are more useful than definitions, because they're what people get
  wrong.
- **Flag internal/user-facing splits** rather than hiding them: *(Internally these are
  "tutorials".)* Someone reading the code needs the bridge.
- **Include the informal word** where a real one exists — *Informally "pedals"* — so the team's
  actual speech is in the document instead of competing with it.
- **Only real terms.** Every entry must be a word this project actually uses, in the code or on
  screen. Do not define generic engineering words, and do not invent terms to fill out a section.
  A 20-entry glossary that's all load-bearing beats a 60-entry one you have to scroll past.
- **No entry longer than about three lines.** If a concept needs a paragraph it belongs in the
  architecture doc, with the glossary holding the one-line version and a pointer.

### 4. Wire it in, or it rots

A glossary nobody is pointed at is a file. Do all of these:

- **`CLAUDE.md` / `AGENTS.md`** — a short Vocabulary rule: follow the locked terms in
  `GLOSSARY.md` for anything user-facing, and **challenge any new term against it**. That last
  clause is what makes it live: a new name has to argue with the document before it lands.
- **`README.md`** (or the roadmap) — one line linking it, naming three or four headline terms.
- **The design doc**, if there is one — point its naming section at the glossary rather than
  restating terms, so the two can't drift apart.
- Mention to the user that "update the glossary" belongs in the definition-of-done for any
  feature that ships a new name.

Keep the wiring to a line or two per file. Do not restate definitions outside `GLOSSARY.md` —
one copy, everywhere else links.

---

## Audit an existing glossary

Same evidence-gathering pass, then compare the document against reality and report before you
edit. Look for, in rough order of value:

1. **Terms in the product that aren't in the glossary** — the commits since the glossary last
   changed are where these live (`git log --oneline -- GLOSSARY.md` for the last touch, then
   `git log --oneline <that>..HEAD`).
2. **Glossary terms the code no longer uses** — renamed or deleted. Either the doc is stale or
   the rename was a mistake; ask which.
3. **Definitions the code contradicts.** The most valuable finding and the easiest to miss.
4. **New collisions** — a word that has quietly acquired a second meaning since.

Report the drift as a list, then fix what the user confirms. Prefer surgical edits to a rewrite:
a rewrite loses the carefully-argued distinctions that are the point of the page.

---

## Rules

- **Evidence before opinion.** Never propose vocabulary you haven't found in the project. The
  glossary records the language the project has; it is not a naming exercise.
- **The user owns the words.** They know the history and the domain. You find the contradictions
  and force the choice — you don't make it. Where you do propose, propose one option with a
  reason, not a menu.
- **Disagreement is the deliverable.** If the code and the UI use different words, saying so is
  worth more than the finished page. Surface it even when the user didn't ask.
- **Don't rename any code.** Settling that `section` should be `scene` produces a glossary entry
  and, if the user wants it, a separate piece of work. Never fold a rename into this task.
- **Stop when it isn't warranted.** A project with no invented vocabulary doesn't need this. Say
  that plainly instead of delivering filler.
