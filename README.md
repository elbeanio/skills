# skills

A few [Claude Code](https://claude.com/claude-code) skills for starting, planning and naming things in a project.

- **orient**: gets Claude up to speed at the start of a session. It reads the README, roadmap and other project docs, checks them against recent git activity, and reports what the project is, what's next, and what's unclear. Then it stops and waits.
- **plan**: interactive, adversarial planning for a change. It grills you in small batches, settles the decisions that would otherwise interrupt the build, and writes a plan to `plans/`. It won't execute until you say so. For a whole project rather than one change, it uses `project-scale.md` to produce a `PROJECT.md` plus one plan per phase.
- **glossary**: writes, wires in and audits a project's `GLOSSARY.md`, the locked vocabulary for the UI, the code and the docs. It hunts for naming collisions first (one word for two things, two words for one thing) and asks you to settle them.

## Install

Copy or symlink the skill folders you want into `~/.claude/skills/` (or a project's `.claude/skills/`):

```sh
git clone https://github.com/elbeanio/skills.git
ln -s "$PWD/skills/orient" ~/.claude/skills/orient
ln -s "$PWD/skills/plan" ~/.claude/skills/plan
ln -s "$PWD/skills/glossary" ~/.claude/skills/glossary
```

Symlinking means a `git pull` picks up updates.

## Use

Invoke them as slash commands, `/orient`, `/plan <the change>` or `/glossary`, or just ask ("get up to speed on this project", "let's plan X", "we need a glossary") and Claude will pick the matching skill.
