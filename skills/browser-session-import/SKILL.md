---
name: browser-session-import
description: Manage saved cookie profiles, apply a shared default to existing and future BB Browser tabs, switch browser sessions, inspect import history, and open the configured homepage.
---

# Browser Session Import

This plugin retains installation id `browser`. It imports sessions only; use the official `browser-automation` plugin for general page automation.

Requires the native BB desktop Browser and Plugin SDK 0.4.48 or newer with `experimental_desktopBrowsers`. BB desktop v0.42.1 (SDK 0.4.47) is not supported. An npx-only web/server installation does not supply native desktop tabs.

## Plugin settings

All management is in **Extensions → Plugins → Browser Session Import**. There is no Browser Session Import side-panel action or thread-header control.

Save named native-profile references or normalized JSON cookie exports. Native profiles are read on their original host when applied. JSON cookie payloads are stored only in the plugin's private, permission-restricted SQLite database; profile lists and history never return cookie values.

Select a host and scan open browsers, then choose an exact browser and saved profile. Applying to an ordinary `personal` tab requires confirmation: all existing shared tabs on that host use the same cookie session, and future ordinary tabs inherit it. That selection is recorded as the last applied shared default. It is not reapplied destructively every time a tab opens. Isolated automation tabs retain independent sessions and can be switched separately without changing the shared default. Controlled destination sessions are rejected rather than taking over automation.

Profile switching changes cookies and reloads the selected page. It does not switch browser extensions, passwords, bookmarks, local storage, or IndexedDB. A failed cookie write attempts to restore the prior cookie snapshot; a restore failure is reported explicitly.

Open an ordinary Browser tab in a thread once before applying a shared default. Native partition reassignment and intercepting BB's built-in new-tab action are not supported plugin APIs.

## Saved-profile operations

- `profiles`: `{ "operation": "profiles" }` returns profile metadata and last-applied shared defaults.
- `save-native-profile`: `{ "operation": "save-native-profile", "name": "Work", "hostId": "<host>", "family": "chrome", "sourceProfileId": "Default" }`.
- `save-json-profile`: `{ "operation": "save-json-profile", "name": "Work", "fileName": "cookies.json", "cookies": [...] }`.
- `rename-profile`: `{ "operation": "rename-profile", "id": "<saved-profile-id>", "name": "New name" }`.
- `remove-profile`: `{ "operation": "remove-profile", "id": "<saved-profile-id>", "confirm": true }` deletes the saved reference/payload and its default label, not cookies already applied to browsers.
- `find-browsers`: `{ "operation": "find-browsers", "hostId": "<host>" }` discovers exact targets across threads and desktop windows.
- `apply-profile`: `{ "operation": "apply-profile", ...target, "profileId": "<saved-profile-id>", "confirmShared": true }`. Use `false` only for an isolated target. A shared target becomes the shared default; isolated targets do not alter that default. A successful cookie switch can report `reloaded: false` if a later reload was unavailable.

## Discover a target

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

## CLI and agent tool

`bb browser-session-import` accepts one JSON operation. The `bb_browser_session_import` tool accepts the same object.

```sh
bb browser-session-import '{"operation":"list-sources","hostId":"host"}'
bb browser-session-import '{"operation":"import-profile","target":{"hostId":"host","instanceId":"instance","generation":"generation","threadId":"thread","tabId":"tab"},"family":"chrome","profileId":"Default"}'
```

Operations:

- `list-instances` — list Browser instances on one host.
- `list-tabs` — list tabs and their `personal` or `automation` profile mode in one exact scope.
- `list-sources` — discover native Chromium and Firefox profiles on a host.
- `history` — read provenance and counts only; it never returns cookie values.
- `import-profile` — extract an exact source profile on its host and copy its cookies into the selected tab profile.
- `import-cookies` — import normalized supplied cookies with a provenance filename.
- `clear` — requires `confirm: true`; clears ALL cookies from the destination session and forgets its shared-default label. Other tabs sharing that session are affected.
- `open-homepage` — creates a visible tab in the selected scope using the configured homepage URL. If a shared default is configured, its cookies are applied to the new isolated tab before navigating to that URL. This does not override BB's built-in new-tab action.

Normalized cookies require `name`, `value`, `domain`, `path`, `secure`, `httpOnly`, `sameSite`, and `expirationDate`. `sameSite` is `no_restriction`, `lax`, `strict`, or `unspecified`; expiration is positive Unix seconds or `null`.

Native profile extraction runs only in the selected browser host worker. macOS reads the corresponding Keychain entry; Linux reads the local keyring when available. Cookie values are never placed in plugin KV history or reported by CLI/tool output. Each write acquires a short lease for the exact tab and releases it even when import fails. A held lease rejects rather than taking control from another automation.
