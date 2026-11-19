#!/bin/sh
# Runs inside dbus-run-session (see run.sh). Expects WORK, OUT, UUID,
# SMOKE_STATE, WAYLAND_DISPLAY. Progress goes to fd 3; on a failed step the
# reason is written to $WORK/failed and the script exits non-zero.
set -eu

CALLS="$SMOKE_STATE/calls.log"
TILE="Main.panel.statusArea.quickSettings.menu._grid.get_children().find(c => c.title === 'NetBird CLI')"
PREFS="global.get_window_actors().map(a => a.meta_window).find(w => w.get_wm_class() === 'org.gnome.Shell.Extensions')"
STEP=startup

say() { echo "smoke: $*" >&3; }
fail() { echo "step $STEP: $*" > "$WORK/failed"; exit 1; }

# ev_try JS: run JS in the shell, print its result; non-zero on JS errors
# (details in eval.log). ev JS: same, but a JS error fails the step.
ev_try() {
    out=$(gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "$1" 2>&1) || out="gdbus: $out"
    echo "$1 => $out" >> "$WORK/eval.log"
    case "$out" in
        "(true, "*) echo "$out" | sed "s/^(true, '\(.*\)')$/\1/" ;;
        *) return 1 ;;
    esac
}
ev() { ev_try "$1" || fail "Eval error (see eval.log) for: $1"; }

# wait_for SECONDS DESCRIPTION COMMAND...: poll COMMAND every 0.25 s.
wait_for() {
    t=$(($1 * 4)); what=$2; shift 2
    while ! "$@" >/dev/null 2>&1; do
        t=$((t - 1)); [ "$t" -gt 0 ] || fail "timed out waiting for $what"
        sleep 0.25
    done
}
js_true() { [ "$(ev_try "$1")" = true ]; }
called() { grep -qx "$1" "$CALLS" 2>/dev/null; }
state_ok() {
    st=$(gnome-extensions info "$UUID" | sed -n 's/^ *State: //p')
    case "$st" in
        ACTIVE|ENABLED) return 0 ;;
        ERROR|"OUT OF DATE") fail "extension state is $st" ;;
        *) return 1 ;;
    esac
}
screenshot() {
    gdbus call --session --dest org.gnome.Shell.Screenshot \
        --object-path /org/gnome/Shell/Screenshot \
        --method org.gnome.Shell.Screenshot.Screenshot false false "$OUT/$1" >/dev/null ||
        fail "screenshot $1 failed"
    [ -s "$OUT/$1" ] || fail "screenshot $1 is empty"
}
shell_ready() {
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Extensions.GetExtensionInfo unsafe@local | grep -q unsafe
}

gnome-shell --headless --wayland --no-x11 --virtual-monitor 1600x1000 \
    --wayland-display "$WAYLAND_DISPLAY" > "$WORK/shell.log" 2>&1 &
sp=$!
trap 'kill "$sp" 2>/dev/null || true' EXIT

wait_for 30 "the nested Wayland socket" test -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY"
wait_for 30 "org.gnome.Shell on the bus" shell_ready
gnome-extensions enable unsafe@local
wait_for 15 "unsafe mode (Eval)" js_true "global.context.unsafe_mode && !Main.layoutManager._startingUp"
ev "Main.welcomeDialog?.close(); Main.overview.hide(); Main.messageTray._bannerBin?.hide(); 'ok'" >/dev/null

STEP="1 (enable)"
say "$STEP"
gnome-extensions enable "$UUID"
wait_for 10 "State ACTIVE/ENABLED" state_ok
wait_for 10 "the NetBird CLI tile" js_true "!!$TILE"
wait_for 10 "first status poll" called "status --json"
wait_for 10 "tile unchecked (Idle)" js_true "$TILE.checked === false && !$TILE._pendingAction"

STEP="2 (toggle)"
say "$STEP"
ev "$TILE.emit('clicked', 1); 'ok'" >/dev/null
wait_for 10 "'netbird up' in calls.log" called up
wait_for 10 "tile checked after up" js_true "$TILE.checked === true"
ev "$TILE.emit('clicked', 1); 'ok'" >/dev/null
wait_for 10 "'netbird down' in calls.log" called down
wait_for 10 "tile unchecked after down" js_true "$TILE.checked === false"

STEP="3 (menu screenshot)"
say "$STEP"
ev "Main.panel.statusArea.quickSettings.menu.open(false); 'ok'" >/dev/null
wait_for 5 "Quick Settings open" js_true "Main.panel.statusArea.quickSettings.menu.isOpen"
ev "$TILE.menu.open(false); 'ok'" >/dev/null
wait_for 5 "tile menu open" js_true "$TILE.menu.isOpen"
sleep 1  # let the menu animation settle
screenshot menu.png
ev "Main.panel.closeQuickSettings(); 'ok'" >/dev/null

STEP="4 (prefs window screenshots)"
say "$STEP"
# Connect before opening prefs (so Networks page shows content)
ev "$TILE.emit('clicked', 1); 'ok'" >/dev/null
wait_for 10 "'netbird up' in calls.log (prefs)" sh -c "grep -qx 'up' '$CALLS'"
wait_for 10 "tile checked before prefs" js_true "$TILE.checked === true"

calls_before=$(wc -l < "$CALLS")
# Screenshot each page: Home, Peers, Networks, Profiles
for page in Home Peers Networks Profiles Settings; do
    echo "$page" > "$NETBIRD_PREFS_PAGE_FILE"
    gnome-extensions prefs "$UUID"
    wait_for 20 "the prefs window ($page)" js_true "!!$PREFS"
    wait_for 10 "prefs CLI calls ($page)" sh -c "[ \$(wc -l < '$CALLS') -gt $calls_before ]"
    sleep 2  # first refresh + rendering
    screenshot "prefs-$page.png"
    ev "$PREFS.delete(global.get_current_time()); 'ok'" >/dev/null
    wait_for 10 "prefs window closed ($page)" js_true "!$PREFS"
    calls_before=$(wc -l < "$CALLS")
done
rm -f "$NETBIRD_PREFS_PAGE_FILE"

# Check that networks list was called (since we were connected)
wait_for 5 "networks list in calls.log" sh -c "grep -qx 'networks list' '$CALLS'"

# Disconnect after closing prefs
ev "$TILE.emit('clicked', 1); 'ok'" >/dev/null
wait_for 10 "'netbird down' after prefs" sh -c "tail -1 '$CALLS' | grep -qx 'down'"
wait_for 10 "tile unchecked after prefs" js_true "$TILE.checked === false"

STEP="5 (disable/enable cycles)"
say "$STEP"
for i in 1 2 3 4 5; do
    gnome-extensions disable "$UUID"
    wait_for 10 "tile removed (cycle $i)" js_true "!$TILE"
    gnome-extensions enable "$UUID"
    wait_for 10 "State ACTIVE/ENABLED (cycle $i)" state_ok
    wait_for 10 "tile back (cycle $i)" js_true "!!$TILE"
done
js_true "Main.panel.statusArea.quickSettings.menu._grid.get_children().filter(c => c.title === 'NetBird CLI').length === 1" ||
    fail "expected exactly one NetBird CLI tile after cycles"
sleep 1  # let late async errors reach the log

STEP="6 (log check)"
say "$STEP"
