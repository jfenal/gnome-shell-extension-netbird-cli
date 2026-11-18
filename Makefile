UUID := netbird@jfenal.github.io
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: install uninstall schemas pack test nested enable disable prefs logs

install: schemas
	mkdir -p $(dir $(INSTALL_DIR))
	ln -sfn $(CURDIR) $(INSTALL_DIR)

uninstall:
	rm -f $(INSTALL_DIR)

schemas:
	glib-compile-schemas --strict schemas

pack:
	mkdir -p dist
	gnome-extensions pack --force --out-dir=dist --extra-source=netbird.js .

test:
	gjs -m tests/test-netbird.js

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

prefs:
	gnome-extensions prefs $(UUID)

# Try it in a nested GNOME Shell window (Wayland) without logging out.
# Settings live in memory, so your real session is untouched.
nested: install
	dbus-run-session -- sh -c 'export GSETTINGS_BACKEND=memory; \
		gnome-shell --devkit --wayland & sleep 10; \
		gnome-extensions enable $(UUID); wait'

logs:
	journalctl --user -f -o cat /usr/bin/gnome-shell
