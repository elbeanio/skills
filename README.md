# skills

A few [Claude Code](https://claude.com/claude-code) skills for starting, planning and naming things in a project, and for cutting down what the agent has to read.

- **orient**: gets Claude up to speed at the start of a session. It reads the README, roadmap and other project docs, checks them against recent git activity, and reports what the project is, what's next, and what's unclear. Then it stops and waits.
- **plan**: interactive, adversarial planning for a change. It grills you in small batches, settles the decisions that would otherwise interrupt the build, and writes a plan to `plans/`. It won't execute until you say so. For a whole project rather than one change, it uses `project-scale.md` to produce a `PROJECT.md` plus one plan per phase.
- **glossary**: writes, wires in and audits a project's `GLOSSARY.md`, the locked vocabulary for the UI, the code and the docs. It hunts for naming collisions first (one word for two things, two words for one thing) and asks you to settle them.
- **afk**: prepares Claude to run unattended when you step away. It works out what's left to do, forecasts everything that would otherwise interrupt you — decisions, missing context, permission prompts — asks it all in one batch before you go, then works the queue and leaves a what-landed/what's-next/what-surprised-me summary for when you're back.
- **jev-triage**: a context firewall. It asks one precise question about every file in a repo at once — via [Jev](https://pi.dev), a model that returns probabilities rather than prose — so the agent reads the six files that survive instead of the sixty a grep matched. On a 186-file repo that's 3.8s and about 2p, and it steps over the traps a grep falls into. It ranks rather than filters, and says what fell below the cut. Not for logs, not for multi-hop questions. Needs an API key; see [`jev-triage/README.md`](jev-triage/README.md).

## Install

Copy or symlink the skill folders you want into `~/.claude/skills/` (or a project's `.claude/skills/`):

```sh
git clone https://github.com/elbeanio/skills.git
ln -s "$PWD/skills/orient" ~/.claude/skills/orient
ln -s "$PWD/skills/plan" ~/.claude/skills/plan
ln -s "$PWD/skills/glossary" ~/.claude/skills/glossary
ln -s "$PWD/skills/afk" ~/.claude/skills/afk
ln -s "$PWD/skills/jev-triage" ~/.claude/skills/jev-triage
```

Symlinking means a `git pull` picks up updates.

`jev-triage` also runs in [Pi](https://pi.dev) — the `SKILL.md` format is the same, so link it into `~/.pi/agent/skills/` as well, or run `sh jev-triage/install.sh` to do both at once. It needs an API key before it will run; see its own README.

## Use

Invoke them as slash commands, `/orient`, `/plan <the change>`, `/glossary` or `/afk`, or just ask ("get up to speed on this project", "let's plan X", "we need a glossary", "I'm stepping out for an hour") and Claude will pick the matching skill.

`jev-triage` is the odd one out: rather than invoking it directly, you'll usually see it used on your behalf when a search turns up more files than are worth reading.
