#!/bin/sh
# Install every skill in this repo into the agents on this machine, by symlink, so one edit
# updates them all and there is no copy to drift.
#
#   sh install.sh          install (or repair) the symlinks
#   sh install.sh --check  verify without changing anything
#   sh install.sh --remove remove the symlinks
#
# Skills are plain SKILL.md directories, so the same folder serves any agent that reads them.
# Only agents actually installed here are touched: no directory tree is conjured for an agent
# you do not use.

set -eu

SRC="$(cd "$(dirname "$0")" && pwd)"

# <marker that the agent is installed>:<where its skills live>
AGENTS="${HOME}/.claude:${HOME}/.claude/skills ${HOME}/.pi:${HOME}/.pi/agent/skills"

mode="${1:-install}"
case "$mode" in
  install|--check|--remove) ;;
  *) echo "usage: sh install.sh [--check|--remove]" >&2; exit 2 ;;
esac

rc=0
agents_found=0

for pair in $AGENTS; do
  home="${pair%%:*}"
  dir="${pair#*:}"
  [ -d "$home" ] || continue
  agents_found=1

  for src in "$SRC"/*/; do
    [ -f "${src}SKILL.md" ] || continue          # a directory is a skill iff it declares one
    name="$(basename "$src")"
    link="${dir}/${name}"

    case "$mode" in
      --check)
        if [ -L "$link" ] && [ "$(readlink "$link")" = "${SRC}/${name}" ] && [ -f "${link}/SKILL.md" ]; then
          echo "ok      $link"
        else
          echo "MISSING $link"
          rc=1
        fi
        ;;
      --remove)
        if [ -L "$link" ]; then rm "$link"; echo "removed $link"; else echo "absent  $link"; fi
        ;;
      install)
        mkdir -p "$dir"
        # Replace only our own symlink; never clobber a real directory someone put there.
        if [ -L "$link" ]; then
          rm "$link"
        elif [ -e "$link" ]; then
          echo "REFUSING: $link exists and is not a symlink — move it aside first" >&2
          rc=1
          continue
        fi
        ln -s "${SRC}/${name}" "$link"
        echo "linked  $link"
        ;;
    esac
  done
done

if [ "$agents_found" = 0 ]; then
  echo "no agent found: looked for ${HOME}/.claude and ${HOME}/.pi" >&2
  exit 1
fi

if [ "$mode" = "install" ]; then
  echo
  echo "jev-triage additionally needs, before it will run:"
  echo "  export JEV_TRIAGE_KEY=..."
  echo "  export JEV_TRIAGE_API_BASE=https://openrouter.ai/api/alpha/decisions"
fi

exit $rc
