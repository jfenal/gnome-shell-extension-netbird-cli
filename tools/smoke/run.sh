#!/bin/sh
# Smoke test: run the extension in a headless nested GNOME Shell (Wayland)
# against a stateful mock netbird CLI, drive it via org.gnome.Shell.Eval,
# and fail on JS errors in the logs or on any failed step.
#
# Nothing touches the real session: own D-Bus session bus, in-memory
# settings, own XDG_DATA_HOME, own Wayland socket (prefs window included).
#
# Usage: tools/smoke/run.sh   (or: make smoke)
# Output: dist/smoke/*.png; logs in a temp dir, kept (and printed) on failure.
set -eu

REPO=$(cd "$(dirname "$0")/../.." && pwd)
HERE="$REPO/tools/smoke"
UUID=netbird-cli@jfenal.github.io
OUT="$REPO/dist/smoke"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/netbird-smoke.XXXXXX")

mkdir -p "$WORK/data/gnome-shell/extensions" "$WORK/state" "$OUT"
rm -f "$OUT"/*.png
ln -s "$REPO" "$WORK/data/gnome-shell/extensions/$UUID"
ln -s "$REPO/tools/screenshot/unsafe@local" "$WORK/data/gnome-shell/extensions/unsafe@local"
glib-compile-schemas "$REPO/schemas"

# Exported before dbus-run-session so D-Bus-activated services (notably the
# org.gnome.Shell.Extensions prefs process) inherit them too: mock CLI first
# in PATH, nested Wayland socket only (no X11 fallback to the real display).
export GSETTINGS_BACKEND=memory XDG_DATA_HOME="$WORK/data" \
    PATH="$HERE/bin:$PATH" SMOKE_STATE="$WORK/state" \
    WAYLAND_DISPLAY="netbird-smoke-$$" GDK_BACKEND=wayland \
    NETBIRD_PREFS_PAGE_FILE="$WORK/prefs-page" WORK OUT UUID
unset DISPLAY

fail() {
    echo "smoke: FAILED: $*" >&2
    echo "smoke: logs kept in $WORK (shell.log, session.log, eval.log, state/calls.log)" >&2
    exit 1
}

echo "smoke: running nested shell (work dir $WORK)"
# inner.sh reports progress on fd 3; everything else goes to session.log.
rc=0
dbus-run-session -- "$HERE/inner.sh" 3>&1 > "$WORK/session.log" 2>&1 || rc=$?

# Step 6: JS errors from the shell (shell.log) or the prefs process
# (session.log, where dbus-daemon puts activated services' output).
# Printed even when an earlier step failed: they usually explain why.
bad=$(cat "$WORK/shell.log" "$WORK/session.log" 2>/dev/null | grep \
    -e 'JS ERROR' -e 'JS WARNING' -e 'Gjs-CRITICAL' -e "$UUID.*[Ee][Rr][Rr][Oo][Rr]" \
    -e "[Ee][Rr][Rr][Oo][Rr].*$UUID" || true)
[ -z "$bad" ] || { echo "smoke: offending log lines:" >&2; echo "$bad" | head -40 >&2; }

[ ! -s "$WORK/failed" ] || fail "$(cat "$WORK/failed")"
[ "$rc" -eq 0 ] || { tail -20 "$WORK/session.log" >&2; fail "nested session exited with status $rc"; }
[ -z "$bad" ] || fail "step 6: errors in shell/prefs logs (above)"

rm -rf "$WORK"
echo "smoke: OK: $OUT/menu.png $OUT/prefs-Home.png $OUT/prefs-Peers.png $OUT/prefs-Networks.png $OUT/prefs-Profiles.png"
