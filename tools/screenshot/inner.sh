#!/bin/sh
# Runs inside dbus-run-session (see run.sh). Expects WORK, HERE, UUID.
set -eu
export GSETTINGS_BACKEND=memory XDG_DATA_HOME="$WORK/data" PATH="$HERE/bin:$PATH"

gnome-shell --headless --wayland --no-x11 --virtual-monitor 1600x1000 \
    > "$WORK/shell.log" 2>&1 &
sp=$!
trap 'kill "$sp" 2>/dev/null || true' EXIT
sleep 12
gnome-extensions enable unsafe@local
gnome-extensions enable "$UUID"
sleep 4

ev() {
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "$1" >> "$WORK/eval.log"
}

ev "Main.overview.hide(); Main.messageTray._bannerBin?.hide();"
sleep 2
ev "Main.panel.statusArea.quickSettings.menu.open(false);"
sleep 2
# Remove items that show host-specific data (battery, Wi-Fi SSID, VPN
# names...). Removed rather than hidden: tiles re-sync their own visibility.
# Fine here, this shell is thrown away.
ev "const qs = Main.panel.statusArea.quickSettings;
    const battery = qs._system?._systemItem?._powerToggle;
    battery?.get_parent()?.remove_child(battery);
    const keep = ['NetBird', 'Dark Style', 'Do Not Disturb'];
    for (const c of qs.menu._grid.get_children())
        if (c.title && !keep.includes(c.title))
            qs.menu._grid.remove_child(c);
    qs.menu._grid.get_children().find(c => c.title === 'NetBird').menu.open(false);"
sleep 2
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Eval \
    "const b = Main.panel.statusArea.quickSettings.menu._boxPointer;
     const [x, y] = b.get_transformed_position();
     const [w, h] = b.get_transformed_size();
     [w, h, x, y].map(Math.round).join(' ')" > "$WORK/box.txt"
gdbus call --session --dest org.gnome.Shell.Screenshot \
    --object-path /org/gnome/Shell/Screenshot \
    --method org.gnome.Shell.Screenshot.Screenshot false false "$WORK/full.png" >/dev/null
