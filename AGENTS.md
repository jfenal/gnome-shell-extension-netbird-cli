# AGENTS.md

GNOME Shell extension (GJS, ES modules) that drives the `netbird` CLI.
See README.md for features and the full list of `make` targets.

## Build and check

```sh
make test     # unit tests (gjs), no GNOME session needed
make lint     # ESLint; installs eslint with npm on first run
make dist     # dist/*.zip (gnome-extensions pack)
make rpm      # dist/*.rpm (noarch + src); runs the tests in %check
make smoke    # headless nested shell with a mock CLI; fails on JS errors
```

Run `make test` and `make lint` before committing.

## Gotchas

- New runtime directory: add it to `--extra-source` in the Makefile `dist`
  target and to `cp -pr` in the spec `%install`.
- New test file: add it to both the Makefile `test` target and the spec
  `%check`.
- Wayland cannot reload the extension in place: use `make nested` or log
  out and back in.

## Release

1. Bump `Version:` in `gnome-shell-extension-netbird-cli.spec` and
   `version-name` in `metadata.json`; add a `%changelog` entry.
2. Commit as `build: X.Y.Z`.
3. Push `main`, then an annotated tag: `git tag -a vX.Y.Z -m "vX.Y.Z — summary"`.

COPR builds every push to `main` (see `.copr/Makefile`).
