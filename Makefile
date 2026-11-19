UUID := netbird-cli@jfenal.github.io
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: install uninstall schemas pack test nested enable disable prefs logs screenshot smoke rpm

install: schemas
	mkdir -p $(dir $(INSTALL_DIR))
	ln -sfn $(CURDIR) $(INSTALL_DIR)

uninstall:
	rm -f $(INSTALL_DIR)

schemas:
	glib-compile-schemas --strict schemas

pack:
	mkdir -p dist
	gnome-extensions pack --force --out-dir=dist --extra-source=netbird --extra-source=shell --extra-source=prefs --extra-source=icons --extra-source=LICENSES .

test:
	gjs -m tests/test-netbird.js
	gjs -m tests/test-icons.js
	gjs -m tests/test-model.js
	gjs -m tests/test-polling.js

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

# Regenerate screenshots/quick-settings.png (headless nested shell, demo data).
screenshot:
	tools/screenshot/run.sh

# Headless nested-Wayland smoke test with a mock CLI; fails on JS errors.
smoke:
	tools/smoke/run.sh

# Build dist/*.rpm (noarch + src) from the current tree.
rpm:
	tools/build-rpm.sh
