# COPR "make_srpm" build method: COPR runs, as root in a fresh chroot,
#   make -f .copr/Makefile srpm outdir=<dir> spec=<spec>
# from the root of a clone of this repository.
#
# Builds the SRPM from the checked-out commit (not a release tarball), so
# every push to main can be rebuilt by COPR.

outdir ?= $(CURDIR)/build
spec ?= gnome-shell-extension-netbird-cli.spec

.PHONY: srpm

srpm:
	dnf -y install git rpm-build
	git config --global --add safe.directory "$(CURDIR)"
	set -eu; \
	name=$$(rpmspec -q --srpm --qf '%{name}' "$(spec)"); \
	version=$$(rpmspec -q --srpm --qf '%{version}' "$(spec)"); \
	src=$$(mktemp -d); \
	git archive --format=tar.gz --prefix="$$name-$$version/" \
	    -o "$$src/$$name-$$version.tar.gz" HEAD; \
	rpmbuild -bs --define "_sourcedir $$src" --define "_srcrpmdir $(outdir)" "$(spec)"
