#!/bin/sh
# Capture screenshots/quick-settings.png from a headless nested GNOME Shell,
# using a fake netbird CLI (demo data) and in-memory settings, so nothing
# from the real session (network names, hostnames, IPs) leaks into it.
#
# Usage: tools/screenshot/run.sh   (or: make screenshot)
set -eu

REPO=$(cd "$(dirname "$0")/../.." && pwd)
HERE="$REPO/tools/screenshot"
UUID=netbird-cli@jfenal.github.io
OUT="$REPO/screenshots/quick-settings.png"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/data/gnome-shell/extensions"
ln -s "$REPO" "$WORK/data/gnome-shell/extensions/$UUID"
ln -s "$HERE/unsafe@local" "$WORK/data/gnome-shell/extensions/unsafe@local"
glib-compile-schemas "$REPO/schemas"

WORK="$WORK" HERE="$HERE" UUID="$UUID" \
    dbus-run-session -- "$HERE/inner.sh" > "$WORK/session.log" 2>&1 || {
    echo "nested shell failed; log:" >&2; tail -20 "$WORK/session.log" >&2; exit 1; }

# box.txt holds e.g. ("1192 32 402 613",) -> "W H X Y"
set -- $(tr -dc '0-9 ' < "$WORK/box.txt")
mkdir -p "$(dirname "$OUT")"
magick "$WORK/full.png" -crop "${1}x${2}+${3}+${4}" +repage "$OUT"
echo "wrote $OUT (${1}x${2})"
