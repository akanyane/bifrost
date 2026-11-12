#!/usr/bin/env bash
# bifrost-gate: the single remote entry point for Bifrost. THIS is the security boundary.
#
# Runs as a forced command (authorized_keys) through sudo, as root. No matter what the client
# (or an agent with access to a local terminal) sends with the Bifrost key, only the verbs
# below, with validated arguments, are ever executed.
#
# Install as root:root 0755 at /usr/local/bin/bifrost-gate (see remote/install.md).
# Protocol:   [bifrost-gate] <verb> [args...]  (tokens [A-Za-z0-9_.:-], space separated)
# Exit codes: 0 ok | 2 invalid input | 126 refused by policy

set -euo pipefail
set -f # never glob
export LC_ALL=C
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

DOCKER=/usr/bin/docker
ALLOWLIST=/etc/bifrost/containers

CHARS_RE='^[A-Za-z0-9 _.:-]*$'
NAME_RE='^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$'
INT_RE='^[0-9]{1,4}$'

deny() { echo "bifrost-gate: $*" >&2; exit 126; }
bad() { echo "bifrost-gate: $*" >&2; exit 2; }

raw="${SSH_ORIGINAL_COMMAND-}"
# Direct execution (no SSH), handy for testing on the server itself: sudo bifrost-gate ping
if [[ -z $raw && $# -gt 0 ]]; then raw="$*"; fi

[[ ${#raw} -le 512 ]] || bad "command too long"
[[ $raw =~ $CHARS_RE ]] || bad "disallowed characters"

read -r -a argv <<<"$raw"
if [[ ${argv[0]-} == bifrost-gate ]]; then argv=("${argv[@]:1}"); fi
argc=${#argv[@]}
verb=${argv[0]-}

# A container must match the name pattern AND be listed (exact line) in the server allowlist.
allowed() {
  [[ $1 =~ $NAME_RE ]] || return 1
  [[ -r $ALLOWLIST ]] || return 1
  grep -Fxq -- "$1" "$ALLOWLIST"
}

int_between() { [[ $1 =~ $INT_RE ]] && ((10#$1 >= $2 && 10#$1 <= $3)); }

case $verb in
  ping)
    ((argc == 1)) || bad "usage: ping"
    echo pong
    ;;

  ps)
    ((argc == 1)) || bad "usage: ps"
    exec "$DOCKER" ps --all --no-trunc --format '{{json .}}'
    ;;

  logs)
    ((argc == 3 || argc == 4)) || bad "usage: logs <container> <tail> [since_min]"
    allowed "${argv[1]}" || deny "container not in allowlist: ${argv[1]}"
    int_between "${argv[2]}" 1 500 || bad "tail must be between 1 and 500"
    args=(logs --timestamps --tail "$((10#${argv[2]}))")
    if ((argc == 4)); then
      int_between "${argv[3]}" 1 1440 || bad "since_min must be between 1 and 1440"
      args+=(--since "$((10#${argv[3]}))m")
    fi
    exec "$DOCKER" "${args[@]}" "${argv[1]}" 2>&1
    ;;

  restart)
    ((argc == 2)) || bad "usage: restart <container>"
    allowed "${argv[1]}" || deny "container not in allowlist: ${argv[1]}"
    exec "$DOCKER" restart -t 10 "${argv[1]}"
    ;;

  overview)
    ((argc == 1)) || bad "usage: overview"
    echo "## host";   hostname; uptime -p
    echo "## load";   cut -d' ' -f1-3 /proc/loadavg
    echo "## memory"; free -h
    echo "## disk";   df -h -x tmpfs -x devtmpfs -x overlay -x squashfs
    echo "## docker"; echo "running: $("$DOCKER" ps -q | wc -l)"
    ;;

  *)
    deny "verb not allowed: ${verb:-<empty>}"
    ;;
esac
