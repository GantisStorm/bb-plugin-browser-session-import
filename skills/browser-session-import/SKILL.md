---
name: browser-session-import
description: Import local browser profiles or JSON cookie exports into a selected BB Browser tab, inspect history, open the configured homepage, or clear imported cookies.
---

# Browser Session Import

This plugin retains installation id `browser`. It imports sessions only; use the official `browser-automation` plugin for general page automation.

Requires the native BB desktop Browser and Plugin SDK 0.4.48 or newer with `experimental_desktopBrowsers`. BB desktop v0.42.1 (SDK 0.4.47) is not supported. An npx-only web/server installation does not supply native desktop tabs.

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
- `clear` — requires `confirm: true`; clears imported cookies from the selected shared Browser profile.
- `open-homepage` — creates a visible tab in the selected scope using this plugin’s configured homepage URL.

Normalized cookies require `name`, `value`, `domain`, `path`, `secure`, `httpOnly`, `sameSite`, and `expirationDate`. `sameSite` is `no_restriction`, `lax`, `strict`, or `unspecified`; expiration is positive Unix seconds or `null`.

Native profile extraction runs only in the selected browser host worker. macOS reads the corresponding Keychain entry; Linux reads the local keyring when available. Cookie values are never placed in plugin KV history or reported by CLI/tool output. Each write acquires a short lease for the exact tab and releases it even when import fails. A held lease rejects rather than taking control from another automation.
