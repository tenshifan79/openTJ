#!/bin/sh
# Starts the packaged web server and keeps it running.
#
# The defaults fit a small container such as Director's (about 95 MiB of RAM):
# measured at roughly 65 MiB after every page has loaded and under 80 MiB after
# sustained load, against 220 MiB or more with stock Node settings.
# Override any of them from the environment.
set -u

here="$(dirname "$0")"

# glibc: one arena that trims promptly, so freed native memory returns to the system.
export MALLOC_ARENA_MAX="${MALLOC_ARENA_MAX:-1}"
export MALLOC_TRIM_THRESHOLD_="${MALLOC_TRIM_THRESHOLD_:-131072}"
export MALLOC_MMAP_THRESHOLD_="${MALLOC_MMAP_THRESHOLD_:-131072}"
export MALLOC_TOP_PAD_="${MALLOC_TOP_PAD_:-65536}"
export GLIBC_TUNABLES="${GLIBC_TUNABLES:-glibc.malloc.arena_max=1:glibc.malloc.trim_threshold=131072:glibc.malloc.mmap_threshold=131072:glibc.malloc.top_pad=65536}"

# V8 sizes its heap from the host's memory, not the container's. Collect early
# and keep the young generation small; the old-space ceiling is a safety limit
# well above the usual 50-60 MiB heap, not a target.
flags="${OPENTJ_NODE_FLAGS:---optimize-for-size --max-old-space-size=96 --max-semi-space-size=1}"

if [ "${OPENTJ_SUPERVISE:-1}" = 0 ]; then
  cd "$here/web" || exit 1
  # shellcheck disable=SC2086
  exec node $flags --import ../runtime-env.mjs server.js
fi

# Director stops restarting a site after five failed starts, so recover here:
# restart the server if it exits, backing off while it keeps failing.
# When started through the "current" symlink that deploy.sh maintains, also
# move to a newly activated release without a manual restart.
active=""
[ -L "$here" ] && active="$(readlink "$here")"
child=""
napper=""

pause() {
  sleep "$1" &
  napper=$!
  wait "$napper"
  napper=""
}

stop() {
  trap - TERM INT HUP
  [ -n "$napper" ] && kill "$napper" 2>/dev/null
  if [ -n "$child" ]; then
    kill -TERM "$child" 2>/dev/null
    wait "$child" 2>/dev/null
  fi
  exit 0
}
trap stop TERM INT HUP

delay=2
while :; do
  began=$(date +%s)
  # shellcheck disable=SC2086
  (cd "$here/web" && exec node $flags --import ../runtime-env.mjs server.js) &
  child=$!
  while kill -0 "$child" 2>/dev/null; do
    pause 5
    if [ -n "$active" ] && [ -L "$here" ] && [ "$(readlink "$here")" != "$active" ]; then
      echo "openTJ: a new release was activated; switching to it"
      kill -TERM "$child" 2>/dev/null
      wait "$child" 2>/dev/null
      exec sh "$here/run.sh"
    fi
  done
  wait "$child"
  status=$?
  child=""
  ran=$(( $(date +%s) - began ))
  [ "$ran" -ge 60 ] && delay=2
  echo "openTJ: web process exited with status $status after ${ran}s; restarting in ${delay}s"
  pause "$delay"
  delay=$(( delay * 2 ))
  [ "$delay" -gt 60 ] && delay=60
done
