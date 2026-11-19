#!/bin/sh
# Build the RPM locally from this repo.
#
# Archives the current tree (HEAD plus uncommitted changes to tracked files)
# as the spec's Source0 tarball, then runs rpmbuild with everything under
# dist/rpmbuild. Output: dist/*.rpm
#
# Usage: tools/build-rpm.sh   (or: make rpm)
set -eu

REPO=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO"

SPEC=gnome-shell-extension-netbird-cli.spec
NAME=$(rpmspec -q --srpm --qf '%{name}' "$SPEC")
VERSION=$(rpmspec -q --srpm --qf '%{version}' "$SPEC")
TOP="$REPO/dist/rpmbuild"

rm -rf "$TOP"
mkdir -p "$TOP/SOURCES"

# `git stash create` snapshots the working tree without touching it; empty
# when there are no local changes, in which case HEAD is used.
REF=$(git stash create)
git archive --format=tar.gz --prefix="$NAME-$VERSION/" \
    -o "$TOP/SOURCES/$NAME-$VERSION.tar.gz" "${REF:-HEAD}"

rpmbuild -ba --define "_topdir $TOP" "$SPEC"

find "$TOP/RPMS" "$TOP/SRPMS" -name '*.rpm' -exec cp {} dist/ \;
ls -1 dist/*.rpm
