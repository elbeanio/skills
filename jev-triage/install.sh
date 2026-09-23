#!/bin/sh
# Install jev-triage into every supported harness by symlink, so one edit updates them all
# and there is no copy to drift.
#
#   sh install.sh          install (or repair) the symlinks
#   sh install.sh --check  verify without changing anything
#   sh install.sh --remove remove the symlinks

set -eu

SRC="$(cd "$(dirname "$0")" && pwd)"
NAME="jev-triage"

# Claude Code and Pi use the same SKILL.md format, so the same directory serves both.
TARGETS="${HOME}/.claude/skills ${HOME}/.pi/agent/skills"

mode="${1:-install}"
rc=0

for dir in $TARGETS; do
  link="${dir}/${NAME}"
  case "$mode" in
    --check)
      if [ -L "$link" ] && [ "$(readlink "$link")" = "$SRC" ] && [ -f "${link}/SKILL.md" ]; then
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
      ln -s "$SRC" "$link"
      echo "linked  $link -> $SRC"
      ;;
    *)
      echo "usage: sh install.sh [--check|--remove]" >&2
      exit 2
      ;;
  esac
done

if [ "$mode" = "install" ]; then
  echo
  echo "Set these before use (the tool refuses to run without them):"
  echo "  export JEV_TRIAGE_KEY=..."
  echo "  export JEV_TRIAGE_API_BASE=https://openrouter.ai/api/alpha/decisions"
fi

exit $rc
