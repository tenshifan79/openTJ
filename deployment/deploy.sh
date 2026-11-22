#!/bin/sh
# Installs or updates the prebuilt openTJ package on a small host such as Director.
# Nothing is compiled or installed with npm here: the package is built and tested
# by CI and published as a GitHub release.
#
#   sh deploy.sh                 install the latest release
#   sh deploy.sh director-42.1-abc1234    install a specific release tag
#   sh deploy.sh /path/to/opentj-director-linux-x64.tar.gz    install a local archive
#   sh deploy.sh --rollback      reactivate the previous release (database unchanged)
#
# Layout under $OPENTJ_HOME (default /site/private/opentj):
#   releases/<id>/   one directory per installed release
#   current          symlink to the active release; run.sh follows it
set -eu

home="${OPENTJ_HOME:-/site/private/opentj}"
repo="${OPENTJ_REPO:-tenshifan79/openTJ}"
archive="opentj-director-linux-x64.tar.gz"

say() { printf '%s\n' "openTJ deploy: $*"; }
die() { printf '%s\n' "openTJ deploy: $*" >&2; exit 1; }

mkdir -p "$home/releases"
lock="$home/.deploy.lock"
mkdir "$lock" 2>/dev/null || die "another deploy is running (remove $lock if it is stale)"
work=""
cleanup() { [ -n "$work" ] && rm -rf "$work"; rmdir "$lock" 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 1' INT TERM HUP

activate() {
  ln -s "releases/$1" "$home/.current.$$"
  mv -T "$home/.current.$$" "$home/current"
}

current=""
[ -L "$home/current" ] && current="$(basename "$(readlink "$home/current")")"

if [ "${1:-}" = "--rollback" ]; then
  previous="$(ls -1 "$home/releases" | grep -v '^\.' | grep -vx "$current" | sort | tail -n 1)"
  [ -n "$previous" ] || die "no earlier release is installed"
  activate "$previous"
  say "reactivated $previous (was $current). Database migrations are not rolled back."
  exit 0
fi

[ "$(uname -m)" = "x86_64" ] || die "this package is for Linux x86-64"
command -v node >/dev/null 2>&1 || die "node is not installed; on Director choose the Node.js (Debian) image"

work="$home/releases/.incoming.$$"
mkdir -p "$work"
source="${1:-latest}"
if [ -f "$source" ]; then
  say "using local archive $source"
  cp "$source" "$work/$archive"
  [ -f "$(dirname "$source")/SHA256SUMS" ] && cp "$(dirname "$source")/SHA256SUMS" "$work/SHA256SUMS"
else
  if [ "$source" = "latest" ]; then base="https://github.com/$repo/releases/latest/download"
  else base="https://github.com/$repo/releases/download/$source"; fi
  say "downloading $source from $repo"
  curl -fL --retry 3 --retry-delay 2 -sS -o "$work/SHA256SUMS" "$base/SHA256SUMS" || die "could not download the checksum file from $base"
  curl -fL --retry 3 --retry-delay 2 -# -o "$work/$archive" "$base/$archive" || die "could not download $archive from $base"
fi
if [ -f "$work/SHA256SUMS" ]; then
  (cd "$work" && grep " $archive\$" SHA256SUMS | sha256sum -c - >/dev/null) || die "checksum verification failed; nothing was changed"
  say "checksum verified"
fi

say "extracting (a few thousand files; this can take a minute on network storage)"
mkdir "$work/files"
tar -xzf "$work/$archive" -C "$work/files" --no-same-owner
[ -f "$work/files/web/server.js" ] && [ -f "$work/files/run.sh" ] || die "the archive is not an openTJ package"
commit="$(sed -n 's/.*"commit": *"\([0-9a-f]\{7\}\).*/\1/p' "$work/files/build-info.json" 2>/dev/null | head -n 1)"
id="$(date -u +%Y%m%d-%H%M%S)-${commit:-local}"
rm -f "$work/$archive" "$work/SHA256SUMS"
mv "$work/files" "$home/releases/$id"
rm -rf "$work"; work=""
new="$home/releases/$id"
chmod +x "$new"/*.sh

say "applying database migrations and the base seed"
if ! sh "$new/migrate.sh"; then
  rm -rf "$new"
  die "migration failed; the active release was left unchanged"
fi

activate "$id"
say "activated release $id"

# Director runs the first executable run.sh it finds; point it at the active release.
if [ -d /site ]; then
  found=""
  for path in /site/run.sh /site/private/run.sh /site/public/run.sh; do
    if [ -x "$path" ]; then found="$path"; break; fi
  done
  if [ -z "$found" ]; then
    printf '%s\n' '#!/bin/sh' '# Director entry point. The release itself is managed by deploy.sh.' "exec sh $home/current/run.sh" > /site/run.sh
    chmod +x /site/run.sh
    say "created /site/run.sh; click Restart process in Director once to start the site"
  elif ! grep -q "$home/current/run.sh" "$found"; then
    say "note: $found does not start $home/current/run.sh; update it to use this release"
  fi
fi

# Keep this release and the one it replaced (for --rollback); remove the rest.
for old in $(ls -1 "$home/releases" | grep -v '^\.'); do
  if [ "$old" != "$id" ] && [ "$old" != "$current" ]; then
    rm -rf "$home/releases/$old"
    say "removed old release $old"
  fi
done

if (cd "$new/web" && node --import ../runtime-env.mjs -e "" >/dev/null 2>"$home/.config-check"); then
  say "configuration is valid. A running server switches to this release within a few seconds."
else
  say "the release is installed, but the configuration is incomplete:"
  sed 's/^/    /' "$home/.config-check" | grep -v '^    *at \|node:internal\|^    *$' | head -n 12
  say "fix ${OPENTJ_ENV_FILE:-/site/private/opentj.env}; the server retries by itself within a minute."
fi
rm -f "$home/.config-check"
