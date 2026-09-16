# MQTT-PWA-DASHBOARD

<p align="center"><img src="icon-512.png" width="160" height="160" alt="MQTT-PWA-DASHBOARD icon"></p>

A browser-only MQTT workbench with multiple brokers, live messages, dashboards and an encrypted local vault. Created for **Uli**. Built with plain JavaScript, HTML and CSS. **No PHP, backend, cloud database or continuously running server process.** The interface is German; this documentation is English.

## Quick start

1. Download or clone this repository.
2. Serve the **contents of `dist/`** using a static web server over **HTTPS**. No build or npm installation is needed for normal use.
3. Open the app and create a strong master passphrase of at least 12 characters. There is no default password or password recovery.
4. Add your broker's complete **WebSocket URL**, including its port and path, for example `wss://mqtt.example.org:8084/mqtt`.
5. Connect, subscribe to a topic such as `home/#`, then add widgets or publish messages.
6. Create an encrypted backup under **Einstellungen → Verschlüsseltes Backup**.

For local development, run from the repository root:

```sh
python -m http.server 8080 --directory dist
```

Then open `http://localhost:8080`. Do not open `index.html` using `file://`. Plain HTTP on a LAN address such as `http://192.168.1.10` is **not** sufficient for WebCrypto, service workers or PWA installation. Use HTTPS for access from another device.

The downloadable deployment ZIP contains the ready-to-serve files directly at its root. Repository downloads contain them in `dist/`. Root paths and subdirectory hosting are supported.

## Install as a PWA

- **Android / Chrome or Samsung Internet:** open the HTTPS site in the full browser, unlock the workspace and select **App installieren**. If the browser does not offer an in-page prompt, use its menu and choose **Install app** or **Add to home screen**, as available.
- **iPhone / iPad:** use Safari's **Share → Add to Home Screen**. iOS does not expose Chromium's `beforeinstallprompt` event.
- **Desktop Chrome / Edge:** use the in-page installation button or the browser's install icon/menu.
- After installation, launch from the device's app launcher. The manifest requests `standalone`, without the usual browser navigation bar.

The app includes a stable relative manifest ID, start URL and scope, dedicated 192/512 px icons, a separate maskable 512 px icon, an Apple touch icon and an offline service worker. The install button remains available on narrow mobile screens and hides when running in standalone mode or after a successful install event.

**Hosting requirements:** serve the manifest, icons and service worker from the same origin, without redirects to an HTML sign-in page. Use `application/manifest+json` for `.webmanifest` and a JavaScript MIME type for `.js`. The worker is next to `index.html`, so no broad `Service-Worker-Allowed` header is necessary. Avoid long immutable cache headers for `sw.js` and the manifest. HTTPS needs a browser-trusted certificate.

Private preview hosts or sign-in gateways may prevent the browser or Android's packaging service from retrieving the manifest/icons. For reliable installation, self-host the static files over HTTPS without an external login gateway; the app's local encrypted vault still protects stored user data. Browser, OS and device policy determine whether installation is offered. An in-app browser may offer only a shortcut.

After deploying an update, close every tab/window of the app and reopen it. The new service worker activates once old clients close; it does not reload an active MQTT workspace. The app shell works offline after its first successful cache installation. MQTT still needs a reachable broker.

## Features

| Area | Included |
| --- | --- |
| Brokers | Multiple simultaneous connections, add/edit/delete/duplicate, import/export, status, connection test through Connect |
| Connection | MQTT 3.1.1 / 5.0, WS/WSS, username/password, stable client ID, keepalive, reconnect, persistent sessions |
| Publish | Text/JSON, JSON validation/formatting, QoS 0/1/2, retain, recent topics and named presets |
| Subscribe | Multiple filters, `+` and `#` wildcards, QoS, pause/resume/remove |
| Explorer | Observed topic tree, discovery, favorites, last values, local counts and average rates |
| Messages | Live view, pause display without pausing reception, broker/topic/payload filters, color-coded topics, detail and copy |
| History | Encrypted local storage, date filters, pagination, CSV/JSON export, reuse a message in Publish |
| Dashboard | Values, text, JSON fields, switches, buttons, gauges, status indicators and numeric charts |
| Rules | Numeric/equality/contains/any conditions; MQTT publish, browser notification or HTTPS POST |
| Recording | Incoming-message capture, JSON export/import, confirmed replay with target broker, prefix, speed and stop |
| Security | Master-passphrase vault, encrypted backups, password change, manual lock and inactive-tab lock |
| PWA | Dedicated application icons, responsive layout, installation support and cached offline shell |

The **demo broker is local simulation only**, with clearly labeled sample data. It never connects to a public MQTT broker. Real brokers connect only after the user selects Connect. The app has no analytics, external fonts or runtime CDN dependencies. MQTT.js 5.14.1 is bundled locally; see its [MIT license](vendor/MQTT-LICENSE.md).

## Local data security

Settings, broker profiles, remembered broker passwords, favorites, presets, widgets, rules, history and recordings are encrypted **before** being written to IndexedDB.

- **AES-256-GCM** provides authenticated encryption for each workspace snapshot.
- **PBKDF2-SHA-256**, 600,000 iterations and a random 128-bit salt derive the key from the master passphrase.
- Each save uses a fresh random 96-bit IV.
- The non-exportable WebCrypto key is kept in memory only. Neither the key nor the master passphrase is stored in localStorage, sessionStorage, IndexedDB, the service-worker cache or the source code.
- The workspace must be unlocked again after every page load.
- Broker passwords can optionally be kept only for the current session; remembered passwords remain inside the encrypted vault.
- Locking disconnects brokers, stops replay and reloads the app. Inactive tabs lock after five minutes by default; this can be changed. Background timer throttling means this deadline is not a strict real-time security boundary.
- Web Locks prevents two tabs from overwriting the same workspace with conflicting encrypted snapshots.

Encryption protects **data at rest**. It cannot protect an unlocked workspace against malicious extensions, modified application code, XSS, malware or a compromised device. The broker necessarily receives its authentication credentials: use **WSS**, not unencrypted WS. Incoming text is escaped, not executed as HTML; rules do not use `eval`.

Browser notifications and explicitly exported history, recordings or broker JSON may contain plaintext. Broker JSON exports exclude passwords. CSV exports escape formula-like cells. Use the **encrypted backup** to preserve the complete workspace securely. Old backups retain their old passphrase after a password change.

There is **no password recovery**. Clearing browser data or storage eviction can permanently remove the vault. Keep encrypted backups outside the browser.

## MQTT behavior and limitations

- A regular MQTT TCP port such as 1883 or 8883 is insufficient: the broker must expose **MQTT over WebSockets**. HTTPS pages require WSS with a trusted certificate; certificate checks cannot be disabled here.
- The browser must reach the broker. Private LAN addresses normally require the same LAN or a VPN; browser local-network permission may also be required.
- Persistent sessions use a stable client ID and `clean=false`; MQTT 5 additionally uses a session expiry interval of **86,400 seconds**. Offline QoS-1/2 delivery depends on the broker, publication QoS and subscriptions. QoS 0 is not reliably queued. MQTT.js's protocol handshake store is not persisted, so interrupted QoS-2 exchanges are not guaranteed across browser restarts.
- Retained delivery supplies the last retained value, not an entire archive.
- A closed or OS-suspended app does not keep receiving, running rules or replaying. The service worker has no MQTT connection. Notifications with the app fully closed require a separate push/background service.
- HTTP rules perform an outgoing **HTTPS POST**, require CORS, omit cookies and time out after 10 seconds. A browser-only app cannot provide an incoming HTTP endpoint.
- New rules are disabled by default and ignore retained messages unless explicitly enabled. A cooldown of at least one second limits loops but cannot prevent repeated device switching caused by a poorly designed rule. Use separate state and command topics.
- Replay sends real MQTT commands and requires confirmation. Retain is always disabled; messages are sent at least 100 ms apart. Replaying demo data to real devices also requires deliberate confirmation.
- Switches show the received state, not an optimistic copy of the last command. Widgets subscribe to their state topics automatically. Deleting a widget leaves its subscription available for other uses.
- Pausing one subscription does not block delivery through another overlapping active filter. Removal while offline is queued for unsubscribe on reconnect.
- Binary payloads are decoded as UTF-8 text. This is not a binary-preserving recorder/replayer.

## Resource limits

- Payloads: maximum **256 KB** each.
- History: **5,000** messages by default, configurable from 100 to 20,000, with an additional approximately **12 MB** estimated text-memory cap.
- Topic index: at most 2,000 topics; tree display: at most 500 topics and 16 levels.
- Topic statistics are local observations, not lifetime broker counters.
- Charts show the last 40 numeric samples, evenly spaced by sample rather than elapsed time.
- Recordings: at most 10 recordings, each limited to 10,000 messages or approximately 5 MB of payload text.
- Changes are saved as throttled encrypted snapshots, approximately every 750 ms while data changes. Abrupt termination can lose recent unsaved changes. This is a personal workbench, not a lossless high-throughput archive.

## Development and tests

Runtime files are in `dist/`; they are authored deployment assets and intentionally tracked in Git. Node.js is needed only for development tests, not for hosting or using the app.

```sh
npm ci
npm test
```

Tests use a disposable local Aedes WebSocket broker, synthetic credentials and in-memory IndexedDB. They cover encryption/tamper rejection, password changes, MQTT publish/subscribe, retained delivery, persistent-session queueing, rules, recordings and DOM workflows. PWA checks validate manifest paths, icon dimensions, app metadata and offline-worker routing/cache isolation. They do not prove installation on every real Android/iOS device.

| File | Purpose |
| --- | --- |
| `dist/app.js` | Interface, forms, exports, replay and vault startup |
| `dist/core.js` | MQTT connections, rules, history and demo |
| `dist/vault.js` | WebCrypto, IndexedDB and encrypted backups |
| `dist/pwa.js` | Install prompt and platform-specific installation guidance |
| `dist/sw.js` | Static offline shell only |
| `dist/manifest.webmanifest` | Application identity and installation metadata |
| `tests/` | Protocol, encryption, DOM and PWA checks |

Requires a current browser with ES modules, WebCrypto, IndexedDB, Web Locks and native `dialog`. Obsolete Fire OS browsers are not supported.

## References

- [MQTT.js documentation](https://github.com/mqttjs/MQTT.js)
- [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [MDN: WebCrypto](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto)
