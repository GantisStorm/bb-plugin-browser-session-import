---
name: browser-session-import
description: Import one browser cookie session into the shared BB Browser session, or clear it.
---

# Browser Session Import

This plugin retains installation id `browser`. It imports sessions only; use the official `browser-automation` plugin for general page automation.

Requires the native BB desktop Browser and Plugin SDK 0.4.48 or newer with `experimental_desktopBrowsers`. BB desktop v0.42.1 (SDK 0.4.47) is not supported. An npx-only web/server installation does not supply native desktop tabs.

## What it does

There is no profile library and no per-tab switching. Importing one session writes it into the host's shared BB Browser session, so every ordinary Browser tab — existing and future — uses it. Isolated automation browsers keep their own session. Importing again replaces the session; `clear` removes it.

All of this lives in **Settings → Browser Session Import** (Extensions → Plugins). The plugin registers no side-panel action, no thread-header control, and no top-bar UI.

Imports copy login cookies only, not extensions, passwords, bookmarks, local storage, or IndexedDB. A failed cookie write attempts to restore the prior cookie snapshot; a restore failure is reported explicitly. Each write takes a short lease on one shared tab and releases it even on failure; a held lease rejects rather than taking over automation.

Open an ordinary Browser tab in a thread first — the import applies through that tab's shared session.

## Operations

`bb browser-session-import` accepts one JSON operation. The `bb_browser_session_import` tool accepts the same object. `current` and `clear` take no target.

- `current`: `{ "operation": "current" }` returns the connected host and what is currently imported (or null).
- `list-sources`: `{ "operation": "list-sources", "hostId": "<host>" }` lists local Chromium/Firefox profiles on the host.
- `import-profile`: `{ "operation": "import-profile", "hostId": "<host>", "family": "chrome", "profileId": "Default" }` copies that profile's cookies into the shared session.
- `import-cookies`: `{ "operation": "import-cookies", "hostId": "<host>", "fileName": "cookies.json", "cookies": [...] }` imports supplied normalized cookies.
- `clear`: `{ "operation": "clear", "hostId": "<host>", "confirm": true }` clears ALL cookies from the shared session.

Normalized cookies require `name`, `value`, `domain`, `path`, `secure`, `httpOnly`, `sameSite`, and `expirationDate`. `sameSite` is `no_restriction`, `lax`, `strict`, or `unspecified`; expiration is positive Unix seconds or `null`.

Native profile extraction runs only in the browser host worker. macOS reads the corresponding Keychain entry; Linux reads the local keyring when available. Cookie values are never reported by CLI/tool output.
