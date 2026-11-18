%global uuid netbird@jfenal.github.io

Name:           gnome-shell-extension-netbird
Version:        0.1.0
Release:        1%{?dist}
Summary:        GNOME Shell Quick Settings toggle for NetBird

License:        GPL-2.0-or-later
URL:            https://github.com/jfenal/gnome-shell-extension-netbird
Source0:        %{url}/archive/v%{version}/%{name}-%{version}.tar.gz

BuildArch:      noarch

BuildRequires:  gjs
BuildRequires:  glib2

Requires:       gnome-shell >= 46
# The netbird CLI is packaged as netbird-client (Fedora) or netbird (upstream repo).
Recommends:     /usr/bin/netbird

%description
Quick Settings toggle to connect and disconnect NetBird, driven by the
netbird CLI. Shows connected peers, IP, FQDN and SSO session expiry,
switches profiles, warns before the session expires and can extend it.

%prep
%autosetup -n %{name}-%{version}

%build
# Nothing to build.

%install
install -d %{buildroot}%{_datadir}/gnome-shell/extensions/%{uuid}
install -pm 0644 metadata.json extension.js netbird.js prefs.js \
    %{buildroot}%{_datadir}/gnome-shell/extensions/%{uuid}/
install -Dpm 0644 schemas/org.gnome.shell.extensions.netbird.gschema.xml \
    %{buildroot}%{_datadir}/glib-2.0/schemas/org.gnome.shell.extensions.netbird.gschema.xml

%check
glib-compile-schemas --strict --dry-run schemas
gjs -m tests/test-netbird.js

%files
%license LICENSE
%doc README.md
%{_datadir}/gnome-shell/extensions/%{uuid}/
%{_datadir}/glib-2.0/schemas/org.gnome.shell.extensions.netbird.gschema.xml

%changelog
* Thu Nov 19 2026 Jérôme Fenal <jfenal@redhat.com> - 0.1.0-1
- Initial package
