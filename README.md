# skills

Agent skills for starting, planning and naming things in a project — and for cutting down what
the agent has to read.

Each one is a plain `SKILL.md` directory, so it works in any agent that reads them.
[Claude Code](https://claude.com/claude-code) and [Pi](https://pi.dev) are the two that get
tested.

- **orient**: gets the agent up to speed at the start of a session. It reads the README, roadmap and other project docs, checks them against recent git activity, and reports what the project is, what's next, and what's unclear. Then it stops and waits.
- **plan**: interactive, adversarial planning for a change. It grills you in small batches, settles the decisions that would otherwise interrupt the build, and writes a plan to `plans/`. It won't execute until you say so. For a whole project rather than one change, it uses `project-scale.md` to produce a `PROJECT.md` plus one plan per phase.
- **glossary**: writes, wires in and audits a project's `GLOSSARY.md`, the locked vocabulary for the UI, the code and the docs. It hunts for naming collisions first (one word for two things, two words for one thing) and asks you to settle them.
- **afk**: prepares the agent to run unattended when you step away. It works out what's left to do, forecasts everything that would otherwise interrupt you — decisions, missing context, permission prompts — asks it all in one batch before you go, then works the queue and leaves a what-landed/what's-next/what-surprised-me summary for when you're back.
- **jev-triage**: a context firewall. It asks one precise question about every file in a repo at once — via [Jev](https://pi.dev), a model that returns probabilities rather than prose — so the agent reads the six files that survive instead of the sixty a grep matched. It ranks rather than filters, and says what fell below the cut. Not for logs, not for multi-hop questions. Needs Node 20+ and an API key; see [`jev-triage/README.md`](jev-triage/README.md).

## Install

```sh
git clone https://github.com/elbeanio/skills.git
sh skills/install.sh          # symlink every skill into the agents installed here
sh skills/install.sh --check  # verify
sh skills/install.sh --remove # undo
```

It only touches agents you actually have — `~/.claude/skills/` and `~/.pi/agent/skills/` — and
refuses to overwrite anything that isn't its own symlink. Symlinks, so a `git pull` updates every
agent at once.

By hand, for one skill and one agent:

```sh
ln -s "$PWD/skills/orient" ~/.claude/skills/orient
```

## Use

Where your agent supports slash commands, they're `/orient`, `/plan <the change>`, `/glossary`
and `/afk`. Otherwise just describe the situation — "get up to speed on this project", "let's
plan X", "we need a glossary", "I'm stepping out for an hour" — and the matching skill is picked
from its description.

`jev-triage` is the odd one out: rather than invoking it directly, you'll usually see it used on
your behalf when a search turns up more files than are worth reading.

## Development

`jev-triage` is the only skill with code in it. Its tests are offline and need no API key:

```sh
cd jev-triage && node --test tests/*.test.mjs
```

MIT licensed.
