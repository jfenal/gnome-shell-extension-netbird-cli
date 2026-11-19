# Upstream Feature Parity (CLI-based) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `netbird-cli@jfenal.github.io` to feature parity with the official
`gnome@netbird.io` extension (netbirdio/gnome-extension @ a182a53) while keeping
the `netbird` CLI as the only transport, so it works with a stock daemon (no
`--enable-json-socket`).

**Architecture:** All daemon access stays in `Gio.Subprocess` calls to the
`netbird` CLI. Pure parsers (CLI text/JSON → plain objects) live in one module
and are unit-tested with gjs; commands live in a thin runner. The Shell side
keeps the Quick Settings toggle; a new multi-page preferences window ("NetBird
window", like upstream's) hosts status, peers, networks, profiles, daemon
settings and debug bundles. Status stays polled (the CLI has no
`SubscribeStatus`), with faster polling while the menu or window is open.

**Tech Stack:** GJS (ESM), GNOME Shell 46–50, GTK4/libadwaita, `netbird` CLI ≥ 0.77
(`debug config` exists from 0.77; installed: 0.77.1).

**Spec:** this document — the parity review below is the spec.

---

## Parity review

Upstream talks to `/var/run/netbird-http.sock` (grpc-gateway JSON, 21 daemon
methods, streamed status). We talk to the CLI. CLI equivalents were checked
against netbird source (`client/cmd/*.go`, v0.83.0-rc.1) and `netbird --help` 0.77.1.

| Feature | Upstream | Ours today | CLI path | Plan |
|---|---|---|---|---|
| Connect / disconnect toggle | ✓ | ✓ (+ abort while connecting) | `up` / `down` | — |
| Status subtitle | IP or state | peers count or state | `status --json` | keep |
| IPv4 / FQDN in menu | header subtitle | ✓ | `netbirdIp`, `fqdn` | — |
| IPv6 | window | ✗ | `netbirdIpv6` (omitempty) | T3 |
| Copy IP (menu + click-to-copy in window) | ✓ | ✗ | — | T3, T5 |
| Profile switch in menu | ✓ | ✓ (+ reconnect) | `profile select` | — |
| Profile add / rename / remove / sign out | ✓ | ✗ | `profile add/rename/remove`, `logout --profile` | T8 |
| Session-expiry warning + Extend | ✓ (fixed 5 min) | ✓ (configurable) | `login --extend` | keep ours |
| Session-expired notification + Sign in | ✓ | ✗ | `up` (CLI opens browser) | T3 |
| Branded state icons (needs-login, error…) | ✓ (BSD-3 SVGs) | generic VPN icons | — | T2 |
| "Open NetBird" window | ✓ | prefs only | — | T4 |
| Home page: switch, state, FQDN, IPv4/6 | ✓ | ✗ | `status --json` | T5 |
| Peers page: search, state filter, sort, latency, rx/tx, handshake, copy IP | ✓ | ✗ | `status --json` → `peers.details[]` | T5 |
| Exit-node selector | ✓ | ✗ | `networks list` (range `0.0.0.0/0`/`::/0`) + `networks select` | T7 |
| Resources page (select/deselect routes) | ✓ | ✗ | `networks list/select --append/deselect` | T7 |
| Daemon settings (23 fields) | ✓ via SetConfig | ✗ | read `debug config` (JSON); write `up --<flag>=…` | T9 |
| MDM-managed fields read-only | ✓ | ✗ | `debug config` → `mDMManagedFields` | T9 |
| Feature gates (profiles/networks/settings disabled) | `GetFeatures` | ✗ | no CLI; infer from error text | T8, T7, T9 |
| Debug bundle (upload, anonymize, sysinfo, key) | ✓ | ✗ | `debug bundle [-U] [-A] [-S]` | T10 |
| Trigger update | ✓ | ✗ | no daemon-side CLI equivalent | **skip** |
| GNOME VPN-button guard, disconnect other VPNs, hide `wt0` | ✓ | ✗ | Shell/NM only, transport-independent | T11 |
| JSON-socket setup banner, version floor | ✓ | n/a | — | **skip** (not needed by CLI) |
| Streamed status | ✓ | polling | none | T6 (adaptive polling) |

Ours-only, keep: no socket reconfiguration, configurable expiry lead time,
configurable CLI path, connected-peers count, abort while connecting.

## Global Constraints

- Transport: `netbird` CLI only, via `Gio.Subprocess` with argv arrays (never a shell string). No `eval`, no socket access.
- GNOME Shell 46–50 (`metadata.json` `shell-version`); prefs code is GTK4/libadwaita only, Shell code never imports Gtk.
- Every async call takes a `Gio.Cancellable`; `disable()` cancels it and disconnects every signal (shexli EGO-L-003 already enforced).
- UUID `netbird-cli@jfenal.github.io`, schema `org.gnome.shell.extensions.netbird-cli` — unchanged.
- Clipboard: write-only, only on explicit user action; declare it in `metadata.json` `description` (EGO rule, as upstream does).
- Reused upstream icons keep `LICENSES/NetBird-BSD-3-Clause.txt`.
- `make test`, `make pack`, `make rpm` must stay green after every task; new runtime dirs go into `pack` (`--extra-source`) and the spec `%install`.
- Settings writes go through `netbird up`, which connects: if NetBird was not connected before the write, run `netbird down` after it.

## Review Focus

- CLI absent or daemon down mid-session: every page shows "Daemon unavailable" instead of throwing; nothing loops on errors faster than the poll interval.
- `networks list` while not connected exits non-zero ("not connected"): treat as "no networks", not an error notification.
- Privileged settings refused for non-root (`the daemon refused the settings update: …`): row reverts to the read-back value and a toast shows the reason.
- Peer/profile/network names with spaces or Unicode survive parsing and argv passing (no splitting on whitespace in argv).
- Profiles disabled by the daemon (`profiles are disabled`): profile UI hidden, not repeatedly erroring.

---

## Decisions for review (defaults chosen; change before execution)

1. **License.** Upstream is GPL-3.0-or-later; ours GPL-2.0-or-later. T11 (VPN guard) and any copied code require relicensing to GPL-3.0-or-later. Default: **relicense in T1**, so later tasks may adapt upstream code.
2. **Quick Settings title.** Decided: **"NetBird CLI"** (toggle title, menu header, notification source), so it is distinguishable when the official extension is also installed (T3).
3. **VPN guard** on by default? Default: **setting `guard-gnome-vpn`, default true** (matches upstream).

---

### Task 1: Module split and packaging for growth

**Files:**
- Create: `netbird/cli.js` (runner + command methods, from `netbird.js`)
- Create: `netbird/parse.js` (pure parsers: `parseProfileList`, `secondsUntil`, `formatLocal`, `errorText`, `Status`)
- Delete: `netbird.js`
- Modify: `extension.js`, `tests/test-netbird.js` (imports), `Makefile` (`pack`: `--extra-source=netbird --extra-source=shell --extra-source=prefs --extra-source=icons --extra-source=LICENSES`), `gnome-shell-extension-netbird-cli.spec` (`%install`: `cp -pr netbird shell prefs icons`), `LICENSE` + SPDX headers + spec `License:` → GPL-3.0-or-later (decision 1)

**Interfaces:**
- Produces: `class NetbirdCli { constructor(settings); run(args: string[], cancellable): Promise<{ok, stdout, stderr}>; status(c); profiles(c) }` in `netbird/cli.js`; all parsers exported from `netbird/parse.js`.

- [ ] **Step 1:** Move code without behaviour change; update imports.
- [ ] **Step 2:** Run `make test && make pack && make rpm` → all pass; `unzip -l dist/*.zip` lists `netbird/cli.js`, `netbird/parse.js`.
- [ ] **Step 3:** `make nested`, toggle connects/disconnects as before.
- [ ] **Step 4:** Commit `refactor: split CLI runner and parsers; relicense GPL-3.0-or-later`.

### Task 2: Branded state icons

**Files:**
- Create: `icons/hicolor/scalable/status/netbird-systemtray-{connected,connecting,disconnected,needs-login,error}-symbolic.svg`, `icons/hicolor/scalable/apps/netbird.svg` (copy from upstream), `LICENSES/NetBird-BSD-3-Clause.txt`
- Create: `shell/icons.js`
- Modify: `extension.js` (replace `ICON_*` names with `Gio.FileIcon`s)
- Test: `tests/test-icons.js`

**Interfaces:**
- Produces: `iconFileForState(state: string): string` (pure, filename only) and `class StatusIcons { constructor(extensionDir: Gio.File); forState(state): Gio.Icon; appIcon: Gio.Icon }` in `shell/icons.js`.

Mapping (verbatim from upstream `shell/statusIcons.js`): Connected→connected, Connecting→connecting, Idle→disconnected, NeedsLogin/LoginFailed/SessionExpired→needs-login, Unavailable and unknown→error.

- [ ] **Step 1: Failing test** `tests/test-icons.js`: `check('needs login', iconFileForState('SessionExpired'), 'netbird-systemtray-needs-login-symbolic.svg')`; `check('unknown', iconFileForState('Bogus'), 'netbird-systemtray-error-symbolic.svg')`. Add to `make test`.
- [ ] **Step 2:** `make test` → FAIL (module missing).
- [ ] **Step 3:** Implement `shell/icons.js`; use `StatusIcons` for toggle, header and panel icon; notification source uses `appIcon`.
- [ ] **Step 4:** `make test` → PASS; `make screenshot` shows the NetBird glyph.
- [ ] **Step 5:** Commit `feat: NetBird state icons`.

### Task 3: Quick Settings menu parity

**Files:**
- Modify: `extension.js`
- Modify: `metadata.json` (clipboard sentence in `description`)

**Interfaces:**
- Consumes: `StatusIcons` (T2).
- Produces: none for later tasks.

Changes: toggle title, menu header title and notification source title become **"NetBird CLI"** (also update the `c.title === 'NetBird'` lookup in `tools/screenshot/inner.sh`); header subtitle = host part of `netbirdIp` when connected, else state label (upstream behaviour; peers count stays in the toggle subtitle); add an IPv6 info row from `netbirdIpv6` (hidden when empty); add **Copy IP Address** action (visible only when connected; writes `St.Clipboard` CLIPBOARD, closes menu); add **Open NetBird** action (`Main.panel.closeQuickSettings(); extension.openPreferences()`, visible only when `Main.sessionMode.allowSettings`); when the state goes Connected→…→SessionExpired/NeedsLogin while we had seen Connected, notify **"NetBird Session Expired"** with action **Sign In** → `_runAction('up')`.

- [ ] **Step 1:** Add a `hostAddress(cidr: string): string` to `netbird/parse.js` with test `check('host of cidr', hostAddress('100.92.14.7/16'), '100.92.14.7')`, `check('empty', hostAddress(''), '')`; `make test` FAIL → implement → PASS.
- [ ] **Step 2:** Implement menu changes; extend mock `tools/screenshot/bin/netbird` status JSON with `"netbirdIpv6":"fd00:4e42::7"`.
- [ ] **Step 3:** `make nested`: Copy IP puts `100.x.y.z` on clipboard (`wl-paste`); stop daemon (`sudo systemctl stop netbird`) after connecting with an expired session → expired notification appears once.
- [ ] **Step 4:** `make test && make pack`; commit `feat: copy IP, IPv6, open window, session-expired notice`.

### Task 4: NetBird window shell (multi-page prefs)

**Files:**
- Modify: `prefs.js` (becomes a router: `fillPreferencesWindow` adds pages from `prefs/*.js`)
- Create: `prefs/extensionPage.js` (current poll/icon/expiry/CLI-path rows, moved verbatim)
- Create: `prefs/model.js` (shared polling model for all pages)
- Test: `tests/test-model.js`

**Interfaces:**
- Consumes: `NetbirdCli` (T1).
- Produces: `class WindowModel { constructor(cli: NetbirdCli, intervalSeconds = 2); start(); stop(); refresh(): Promise<void>; connect(signal: 'changed', cb: (state: {status, data, networks, profiles, config}) => void): number; disconnect(id); run(args: string[]): Promise<{ok, stdout, stderr}> /* runs then refresh() */ }` in `prefs/model.js`. Each page module exports `createXPage(model: WindowModel, window: Adw.PreferencesWindow): Adw.PreferencesPage`.

`WindowModel` is a plain JS class with a minimal signal list (no GObject); polling via `GLib.timeout_add_seconds`, stopped on window `close-request`.

- [ ] **Step 1: Failing test** `tests/test-model.js` with a fake CLI object (`{run: async args => ({ok: true, stdout: FIXTURES[args.join(' ')], stderr: ''})}`): after `await model.refresh()`, the `changed` callback received `state.status === 'Connected'` and `state.profiles.length === 2`; a fake that rejects `networks list` yields `state.networks` `[]`, not a throw.
- [ ] **Step 2:** `make test` → FAIL.
- [ ] **Step 3:** Implement `WindowModel`; move existing rows to `prefs/extensionPage.js` (page title "Extension").
- [ ] **Step 4:** `make test` → PASS; `make prefs` opens with the Extension page unchanged.
- [ ] **Step 5:** Commit `feat: multi-page NetBird window scaffold`.

### Task 5: Home and Peers pages

**Files:**
- Create: `prefs/homePage.js`, `prefs/peersPage.js`, `prefs/copyLabel.js`
- Modify: `netbird/parse.js` (`parsePeers`), `prefs.js`
- Test: `tests/test-netbird.js`

**Interfaces:**
- Consumes: `WindowModel` (T4), `hostAddress` (T3).
- Produces: `parsePeers(statusJson: object): Peer[]` where `Peer = {name, fqdn, ip, ipv6, state, connType, latencyMs, bytesRx, bytesTx, lastHandshake /* unix s or 0 */}`; `createCopyLabel(window): {widget: Gtk.Label, setText(text: string)}` (click copies whole text, toast "Copied to clipboard").

Source fields: `peers.details[]` → `fqdn`, `netbirdIp`, `netbirdIpv6`, `status`, `connectionType`, `latency` (Go `time.Duration`, **nanoseconds**), `transferReceived`, `transferSent`, `lastWireguardHandshake` (RFC 3339; Go zero time `0001-01-01T00:00:00Z` → 0). `name` = first FQDN label, else IP, else "Unknown Peer". Sort Connected, Connecting, then others; then by name (`localeCompare`).

Home page: connect `Adw.SwitchRow` (→ `model.run(['up'])`/`['down']`, insensitive while Unavailable), state label, FQDN / IPv4 / IPv6 copy labels (hidden when empty). Peers page: `Gtk.SearchEntry` (name or IP substring, case-insensitive), state filter dropdown (All / Connected / Disconnected), rows with latency (`N ms`), copy-IP button, tooltip `fqdn`, `Status: …`, `Received/Sent: GLib.format_size`, `Last handshake: N minutes ago`; empty states "Not Connected" / "No Peers" / "No Matching Peers" (upstream copy).

- [ ] **Step 1: Failing tests:** `parsePeers` on a fixture with one connected peer (`latency: 12500000`, handshake `2026-11-19T10:00:00Z`) and one idle peer with zero-time handshake → `latencyMs === 13` (rounded), idle `lastHandshake === 0`, connected sorted first; `parsePeers({})` → `[]`; FQDN `"büro-pc.netbird.cloud"` → name `"büro-pc"`.
- [ ] **Step 2:** `make test` → FAIL.
- [ ] **Step 3:** Implement `parsePeers`, pages, copy label.
- [ ] **Step 4:** `make test` → PASS; `make prefs` with mock CLI (`netbird-path` = `tools/screenshot/bin/netbird`, extend its `status --json` with two `peers.details`) shows both peers, search filters, copy works.
- [ ] **Step 5:** Commit `feat: home and peers pages`.

### Task 6: Adaptive polling in Shell

**Files:**
- Modify: `extension.js`

**Interfaces:** none.

Poll every `min(poll-interval, 2)` s while the toggle menu is open or within 30 s after any action; otherwise `poll-interval`. Reschedule on `open-state-changed` and after `_runAction`.

- [ ] **Step 1:** Implement; log interval changes under `NETBIRD_DEBUG=1` only.
- [ ] **Step 2:** `make nested`: `journalctl` shows 2 s cadence with menu open, `poll-interval` cadence when closed.
- [ ] **Step 3:** Commit `feat: faster polling while menu is open`.

### Task 7: Networks — exit node and resources

**Files:**
- Modify: `netbird/parse.js` (`parseNetworks`), `netbird/cli.js` (`networks`, `selectNetworks`, `deselectNetworks`), `prefs/model.js`, `prefs/homePage.js`
- Create: `prefs/networksPage.js`
- Test: `tests/test-netbird.js`

**Interfaces:**
- Produces: `parseNetworks(text: string): Network[]`, `Network = {id, range /* '' for domain routes */, domains: string[], resolvedIps: string[], selected: boolean, isExitNode: boolean}`; `NetbirdCli.networks(c): Promise<Network[]>` (non-zero exit or "No networks available." → `[]`); `selectNetworks(ids: string[], {append: boolean}, c)`; `deselectNetworks(ids: string[], c)`.

Format (from `client/cmd/networks.go`): blocks starting `  - ID: <id>`, then `    Network: <cidr>` **or** `    Domains: <a, b>`, `    Status: Selected|Not Selected`, optional `    Resolved IPs:` followed by `      [<domain>]: <ip>, <ip>` lines or `    Resolved IPs: -`. Exit node ⇔ range `0.0.0.0/0` or `::/0`.

Exit-node combo on Home ("No exit node" + exit IDs): choosing an ID → `deselect <all other exit ids>` then `select --append <id>`; "No exit node" → `deselect <all exit ids>`. Networks page: one `Adw.SwitchRow` per non-exit network (title = id, subtitle = range or domains joined `  •  `); on → `select --append id`, off → `deselect id`. Hidden when `networks` fails with text containing `network selection is disabled` (daemon: "network selection is disabled by the administrator") — store `model.features.networksDisabled = true`.

- [ ] **Step 1: Failing tests:** fixture with a CIDR route (selected), a domain route with two resolved-IP lines (not selected), and an exit `0.0.0.0/0` → 3 objects with expected fields, exit flagged; `parseNetworks('No networks available.\n')` → `[]`; ID with spaces `"office lan"` preserved.
- [ ] **Step 2:** `make test` → FAIL.
- [ ] **Step 3:** Implement parser, CLI methods, model fields, UI.
- [ ] **Step 4:** `make test` → PASS; on a real account with routes, toggling a resource changes `netbird networks list` Status.
- [ ] **Step 5:** Commit `feat: exit node and network resources`.

### Task 8: Profile management

**Files:**
- Create: `prefs/profilesPage.js`
- Modify: `netbird/cli.js`
- Test: manual (CLI calls are argv pass-through)

**Interfaces:**
- Produces: `NetbirdCli.addProfile(name, c)`, `renameProfile(id, newName, c)`, `removeProfile(id, c)`, `logout(id, c)` → `run(['profile','add',name])`, `['profile','rename',id,newName]`, `['profile','remove',id]`, `['logout','--profile',id]`.

Page: active-profile combo (select → `profile select` + `up` if it was connected, same as Shell), buttons Add / Rename (name dialog, blank names rejected, body "Profile names should be short and easy to recognize.") / Sign Out (confirm "You will need to sign in again before reconnecting.") / Remove (destructive confirm "This removes the local NetBird profile and cannot be undone."; disabled for the active profile). Errors → `Adw.Toast` with `errorText`. If any profile call's stderr contains `profiles are disabled`, hide the page and the Shell profile submenu (Shell checks the same string from `profile list`).

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** `make prefs`: add `test 1` (space in name), rename to `test-2`, remove → `netbird profile list` reflects each step.
- [ ] **Step 3:** Commit `feat: profile management`.

### Task 9: Daemon settings

**Files:**
- Create: `netbird/config.js`, `prefs/daemonSettingsPage.js`
- Modify: `netbird/cli.js` (`config`, `applySettings`)
- Test: `tests/test-config.js`

**Interfaces:**
- Produces: `SETTINGS: {key, type: 'bool'|'string'|'uint', flag, invert?: boolean, group, title, subtitle}[]`; `parseConfig(json: string): {values: Record<string, any>, managed: Set<string>}`; `flagsFor(changes: Record<string, any>): string[]`; `NetbirdCli.config(c)` → `run(['debug','config'])` → `parseConfig`; `NetbirdCli.applySettings(changes, wasConnected: boolean, c)` → `run(['up', ...flagsFor(changes)])`, then `run(['down'])` if `!wasConnected`.

Mapping (`debug config` key → `up` flag), groups as upstream:
- General: `serverSSHAllowed`→`--allow-server-ssh`; `disableAutoConnect`→`--disable-auto-connect`; `rosenpassEnabled`→`--enable-rosenpass`; `rosenpassPermissive`→`--rosenpass-permissive`; `blockInbound`→`--block-inbound`
- Connection: `managementUrl`→`--management-url` (string); `interfaceName`→`--interface-name`; `wireguardPort`→`--wireguard-port` (0–65535); `mtu`→`--mtu`
- Network: `networkMonitor`→`--network-monitor`; `disableDns`→`--disable-dns`; `disableClientRoutes`→`--disable-client-routes`; `disableServerRoutes`→`--disable-server-routes`; `blockLanAccess`→`--block-lan-access`; `disableIpv6`→`--disable-ipv6`
- SSH: `disableSSHAuth`→`--disable-ssh-auth`; `enableSSHRoot`→`--enable-ssh-root`; `enableSSHSFTP`→`--enable-ssh-sftp`; `enableSSHLocalPortForwarding`→`--enable-ssh-local-port-forwarding`; `enableSSHRemotePortForwarding`→`--enable-ssh-remote-port-forwarding`; `sshJWTCacheTTL`→`--ssh-jwt-cache-ttl` (0–86400)

Booleans are always emitted as `--flag=true|false` (explicit false). Pre-shared key and lazy connection are not offered (PSK is redacted in `debug config`; lazy mode is ignored since 0.77 per upstream's live results). Each row writes on change, then re-reads `config`; if the read-back differs, revert the row and toast "Setting Could Not Be Saved" + stderr. Rows for keys in `mDMManagedFields` are insensitive with tooltip "Managed by your organization". Page header note: "Saving a setting reconnects NetBird." If `up` stderr contains `update settings are disabled`, make the whole page read-only with that message.

- [ ] **Step 1: Failing tests:** `parseConfig` on a fixture with `"disableDns": true, "mDMManagedFields": ["managementUrl"]` → `values.disableDns === true`, `managed.has('managementUrl')`; `flagsFor({disableDns: false, mtu: 1380, managementUrl: 'https://nb.example.com'})` → `['--disable-dns=false', '--mtu=1380', '--management-url=https://nb.example.com']`; `flagsFor({unknownKey: 1})` throws.
- [ ] **Step 2:** `make test` → FAIL.
- [ ] **Step 3:** Implement module, CLI methods, page.
- [ ] **Step 4:** `make test` → PASS; toggling "Disable NetBird DNS" while disconnected leaves NetBird disconnected and `netbird debug config` shows the new value; toggling "Allow Root Login" as non-root shows the daemon's refusal toast and reverts.
- [ ] **Step 5:** Commit `feat: daemon settings via debug config / up flags`.

### Task 10: Debug bundle

**Files:**
- Create: `prefs/debugBundleDialog.js`
- Modify: `netbird/parse.js` (`parseDebugBundle`), `netbird/cli.js` (`debugBundle`), `prefs/daemonSettingsPage.js` (button row "Create Debug Bundle")
- Test: `tests/test-netbird.js`

**Interfaces:**
- Produces: `parseDebugBundle(stdout: string, stderr: string): {path: string, uploadedKey: string, uploadError: string}`; `NetbirdCli.debugBundle({upload, anonymize, systemInfo}, c)` → `run(['debug','bundle', ...(upload ? ['-U'] : []), ...(anonymize ? ['-A'] : []), `--system-info=${systemInfo}`])`.

Output format: `Local file:\n<path>\n`, then `Upload file key:\n<key>\n` on success, or stderr `upload failed: <reason>` with exit 1 (path still printed). Dialog: switches Upload (default off), Anonymize (default on), Include System Information (default on); spinner text "Creating the debug bundle…"/"Creating and uploading the debug bundle…"; result heading "Debug Bundle Saved" (path, Open Folder via `Gio.AppInfo.launch_default_for_uri` on the parent dir) or "Debug Bundle Uploaded" (key with Copy button).

- [ ] **Step 1: Failing tests:** upload success fixture → `{path: '/tmp/netbird.debug.123.zip', uploadedKey: 'abc/def', uploadError: ''}`; failure fixture (stdout path, stderr `Error: upload failed: 403`) → `uploadError: '403'`, path kept.
- [ ] **Step 2:** `make test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `make test` → PASS; local (no upload) bundle creates the file shown.
- [ ] **Step 5:** Commit `feat: debug bundle dialog`.

### Task 11: GNOME VPN guard

**Files:**
- Create: `shell/vpnGuard.js`, `shell/vpnConnections.js` (adapted from upstream `shell/vpnButtonGuard.js`, `shell/vpnConnections.js`, GPL-3.0-or-later)
- Modify: `extension.js`, `schemas/…netbird-cli.gschema.xml` (key `guard-gnome-vpn` b, default true), `prefs/extensionPage.js` (switch "Manage GNOME VPN" / "Disable GNOME's VPN button while NetBird is connected")

**Interfaces:**
- Produces: `class VpnGuard { constructor(quickSettings, injectionManager, onError); setBlocked(connected: boolean); disconnectActiveVpns(): Promise<void>; destroy() }`.

Behaviour (upstream): while connected, GNOME's VPN quick toggle and its menu are insensitive; before `up` the extension disconnects active NM VPN connections; `wt0` is excluded from GNOME's VPN list while enabled; `destroy()` restores everything. All behind `guard-gnome-vpn`.

- [ ] **Step 1:** Port; call `disconnectActiveVpns()` before `_runAction('up')`, `setBlocked()` from `_sync()`.
- [ ] **Step 2:** `make nested` with an NM VPN profile: connecting NetBird drops the VPN; GNOME VPN toggle greyed; disconnecting or disabling the extension restores it; 10× `gnome-extensions disable/enable` leaves no stale state.
- [ ] **Step 3:** Commit `feat: guard GNOME VPN button while connected`.

### Task 12: Docs, screenshots, release

**Files:**
- Modify: `README.md` (features, comparison with the official extension, "no JSON socket needed"), `tools/screenshot/*` (window pages), `gnome-shell-extension-netbird-cli.spec` (`Version: 0.2.0`, `%changelog`), `metadata.json` (`version-name` `0.2.0`)

- [ ] **Step 1:** Update docs and mock CLI (`networks list`, `debug config` fixtures).
- [ ] **Step 2:** `make test && make pack && make rpm && make screenshot` → all succeed.
- [ ] **Step 3:** Commit `docs: 0.2.0`; push → Copr webhook build succeeds.
