---
name: browser-session-import
description: Save a browser cookie profile and apply it to BB Browser tabs as the shared default or to one isolated browser session.
---

# Browser Session Import

This plugin retains installation id `browser`. It imports sessions only; use the official `browser-automation` plugin for general page automation.

Requires the native BB desktop Browser and Plugin SDK 0.4.48 or newer with `experimental_desktopBrowsers`. BB desktop v0.42.1 (SDK 0.4.47) is not supported. An npx-only web/server installation does not supply native desktop tabs.

## Plugin settings

The plugin lives entirely in **Settings → Browser Session Import** (Extensions → Plugins). It registers no side-panel action, no thread-header control, and no top-bar UI.

Save a named native-profile reference or a normalized JSON cookie export, then apply it. Native profiles are read on their original host when applied. JSON cookie payloads are stored only in the plugin's private, permission-restricted SQLite database; profile lists never return cookie values.

Applying to an ordinary `personal` tab requires confirmation: all existing shared tabs on that host use the same cookie session, and future ordinary tabs inherit it. The applied profile is recorded as the last shared default. Isolated automation tabs keep independent sessions and can be switched separately without changing the shared default. Controlled destination sessions are rejected rather than taking over automation.

Profile switching changes cookies and reloads the selected page. It does not switch browser extensions, passwords, bookmarks, local storage, or IndexedDB. A failed cookie write attempts to restore the prior cookie snapshot; a restore failure is reported explicitly.

## Saved-profile operations

- `profiles`: `{ "operation": "profiles" }` returns profile metadata and last-applied shared defaults.
- `save-native-profile`: `{ "operation": "save-native-profile", "name": "Work", "hostId": "<host>", "family": "chrome", "sourceProfileId": "Default" }`.
- `save-json-profile`: `{ "operation": "save-json-profile", "name": "Work", "fileName": "cookies.json", "cookies": [...] }`.
- `rename-profile`: `{ "operation": "rename-profile", "id": "<saved-profile-id>", "name": "New name" }`.
- `remove-profile`: `{ "operation": "remove-profile", "id": "<saved-profile-id>", "confirm": true }` deletes the saved reference/payload and its default label, not cookies already applied to browsers.
- `find-browsers`: `{ "operation": "find-browsers", "hostId": "<host>" }` discovers exact targets across threads and desktop windows.
- `apply-profile`: `{ "operation": "apply-profile", ...target, "profileId": "<saved-profile-id>", "confirmShared": true }`. Use `false` only for an isolated target. A shared target becomes the shared default; isolated targets do not alter that default. A successful cookie switch can report `reloaded: false` if a later reload was unavailable.

## Direct import

Every write names one exact desktop Browser scope:

```json
{
  "hostId": "host",
  "instanceId": "instance",
  "generation": "generation",
  "threadId": "thread",
  "tabId": "tab"
}
```

- `list-hosts` — list enrolled Browser hosts; only connected hosts can be selected.
- `list-instances` — list Browser instances on one host.
- `list-tabs` — list tabs and their `personal` or `automation` profile mode in one exact scope.
- `list-sources` — discover native Chromium and Firefox profiles on a host.
- `import-profile` — extract an exact source profile on its host and copy its cookies into the selected tab profile.
- `import-cookies` — import normalized supplied cookies with a provenance filename.

Normalized cookies require `name`, `value`, `domain`, `path`, `secure`, `httpOnly`, `sameSite`, and `expirationDate`. `sameSite` is `no_restriction`, `lax`, `strict`, or `unspecified`; expiration is positive Unix seconds or `null`.

Native profile extraction runs only in the selected browser host worker. macOS reads the corresponding Keychain entry; Linux reads the local keyring when available. Cookie values are never reported by CLI/tool output. Each write acquires a short lease for the exact tab and releases it even when import fails. A held lease rejects rather than taking control from another automation.
