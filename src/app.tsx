import { useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type PluginSettingsSectionProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "./vendor/components/ui/button";
import { parseBrowserCookieImport } from "./browser-cookie-import.js";
import type {
  rpcContract,
  CookieSource,
  DiscoveredBrowser,
  SavedProfile,
  SharedDefault,
} from "./contracts.js";

type Host = { id: string; name: string; status: "connected" | "disconnected" };
const inputClass =
  "min-h-11 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground";
const targetKey = (target: DiscoveredBrowser) =>
  JSON.stringify([
    target.hostId,
    target.instanceId,
    target.generation,
    target.threadId,
    target.tabId,
  ]);

function SavedProfileRow({
  profile,
  disabled,
  defaults,
  onRename,
  onRemove,
}: {
  profile: SavedProfile;
  disabled: boolean;
  defaults: SharedDefault[];
  onRename(id: string, name: string): void;
  onRemove(profile: SavedProfile): void;
}) {
  const [name, setName] = useState(profile.name);
  useEffect(() => setName(profile.name), [profile.name]);
  const renameDisabled =
    disabled || !name.trim() || name.trim() === profile.name;
  return (
    <li className="grid gap-2 border-b border-border py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-40 flex-1">
          <span className="sr-only">Name for {profile.name}</span>
          <input
            className={inputClass}
            value={name}
            maxLength={128}
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <Button
          variant="outline"
          disabled={renameDisabled}
          onClick={() => onRename(profile.id, name.trim())}
        >
          Rename
        </Button>
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => onRemove(profile)}
        >
          Delete
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {profile.kind === "native"
          ? `${profile.sourceLabel} / ${profile.profileLabel} · native profile on ${profile.hostId}`
          : `${profile.fileName} · ${profile.cookieCount} saved cookies`}
      </p>
      {defaults.some((entry) => entry.profileId === profile.id) ? (
        <p className="text-xs font-medium">Last applied shared default</p>
      ) : null}
    </li>
  );
}

function BrowserProfileSettings(_: PluginSettingsSectionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [hostId, setHostId] = useState("");
  const [profiles, setProfiles] = useState<SavedProfile[]>([]);
  const [defaults, setDefaults] = useState<SharedDefault[]>([]);
  const [sources, setSources] = useState<CookieSource[]>([]);
  const [nativeChoice, setNativeChoice] = useState("");
  const [name, setName] = useState("");
  const [browsers, setBrowsers] = useState<DiscoveredBrowser[]>([]);
  const [browserChoice, setBrowserChoice] = useState("");
  const [profileChoice, setProfileChoice] = useState("");
  const [confirmShared, setConfirmShared] = useState(false);
  const [pending, setPending] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectedBrowser =
    browsers.find((browser) => targetKey(browser) === browserChoice) ?? null;
  const selectedProfile =
    profiles.find((profile) => profile.id === profileChoice) ?? null;
  const shared = selectedBrowser?.profile === "personal";
  const nativeOptions = sources.flatMap((source) =>
    source.profiles.map((profile) => ({
      source,
      profile,
      key: JSON.stringify([source.family, profile.id]),
    })),
  );
  const native = nativeOptions.find((option) => option.key === nativeChoice);
  const hostDefault = defaults.find((entry) => entry.hostId === hostId);
  const defaultName = profiles.find(
    (profile) => profile.id === hostDefault?.profileId,
  )?.name;
  const compatible = profiles.filter(
    (profile) => profile.kind === "json" || profile.hostId === hostId,
  );

  const refreshProfiles = async () => {
    const overview = await rpc.call("profiles", {});
    if (!mounted.current) return;
    setProfiles(overview.profiles);
    setDefaults(overview.defaults);
    setProfileChoice((current) =>
      overview.profiles.some((profile) => profile.id === current)
        ? current
        : "",
    );
  };
  useEffect(() => {
    mounted.current = true;
    void Promise.all([rpc.call("listHosts", {}), rpc.call("profiles", {})])
      .then(([nextHosts, overview]) => {
        if (!mounted.current) return;
        setHosts(nextHosts);
        setHostId(
          nextHosts.find((host) => host.status === "connected")?.id ?? "",
        );
        setProfiles(overview.profiles);
        setDefaults(overview.defaults);
      })
      .catch((reason) => {
        if (mounted.current)
          setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (mounted.current) setPending(false);
      });
    return () => {
      mounted.current = false;
    };
  }, [rpc]);

  const operate = (work: () => Promise<string | void>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage(null);
    setError(null);
    void work()
      .then((result) => {
        if (mounted.current) setMessage(result ?? null);
      })
      .catch((reason) => {
        if (mounted.current)
          setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        busy.current = false;
        if (mounted.current) setPending(false);
      });
  };
  const selectedTarget = () => {
    if (!selectedBrowser) throw new Error("Choose an open Browser tab first");
    return {
      hostId: selectedBrowser.hostId,
      instanceId: selectedBrowser.instanceId,
      generation: selectedBrowser.generation,
      threadId: selectedBrowser.threadId,
      tabId: selectedBrowser.tabId,
    };
  };

  return (
    <div className="grid gap-6 text-sm text-foreground" aria-busy={pending}>
      <section className="grid gap-3" aria-labelledby="browser-profile-scope">
        <h3 id="browser-profile-scope" className="font-medium">
          Cookie profiles
        </h3>
        <p className="text-muted-foreground">
          Save a native-browser profile reference or a JSON cookie export, then
          apply it to BB&apos;s Browser. This copies login cookies, not
          extensions, passwords, bookmarks, or local storage. Saved JSON cookies
          stay private on the BB server and are never returned to this page.
        </p>
        <label className="grid gap-1">
          Browser host
          <select
            className={inputClass}
            value={hostId}
            disabled={pending}
            onChange={(event) => {
              setHostId(event.target.value);
              setSources([]);
              setNativeChoice("");
              setBrowsers([]);
              setBrowserChoice("");
              setProfileChoice("");
              setConfirmShared(false);
            }}
          >
            <option value="">Choose a host</option>
            {hosts.map((host) => (
              <option
                key={host.id}
                value={host.id}
                disabled={host.status !== "connected"}
              >
                {host.name} · {host.status}
              </option>
            ))}
          </select>
        </label>
        <p className="text-muted-foreground">
          Shared default:{" "}
          <strong className="text-foreground">
            {defaultName ?? "No saved profile applied"}
          </strong>
          . Ordinary BB Browser tabs on this host share one persistent cookie
          session. Applying a shared default updates existing shared tabs and is
          inherited by future ordinary tabs. Isolated automation browsers keep
          their own session.
        </p>
      </section>

      <section
        className="grid gap-3 border-t border-border pt-5"
        aria-labelledby="browser-profile-save"
      >
        <h3 id="browser-profile-save" className="font-medium">
          Save a profile
        </h3>
        <label className="grid gap-1">
          Profile name
          <input
            className={inputClass}
            value={name}
            maxLength={128}
            disabled={pending}
            placeholder="For example, Work or Personal"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={pending || !hostId}
            onClick={() =>
              operate(async () => {
                const next = await rpc.call("listSources", { hostId });
                if (mounted.current) {
                  setSources(next);
                  setNativeChoice("");
                }
                return next.length
                  ? "Choose a local profile below"
                  : "No local profiles found. You can save a JSON cookie export instead.";
              })
            }
          >
            Find local browser profiles
          </Button>
          <Button
            variant="outline"
            disabled={pending || !name.trim()}
            onClick={() => fileInput.current?.click()}
          >
            Save JSON cookie profile
          </Button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="JSON cookie profile file"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            operate(async () => {
              if (file.size > 16 * 1024 * 1024)
                throw new Error(
                  "Choose a JSON cookie export smaller than 16 MB",
                );
              await rpc.call("saveJsonProfile", {
                name: name.trim(),
                fileName: file.name,
                cookies: parseBrowserCookieImport(
                  JSON.parse(await file.text()),
                ),
              });
              await refreshProfiles();
              if (mounted.current) setName("");
              return "JSON cookie profile saved privately";
            });
          }}
        />
        {nativeOptions.length ? (
          <>
            <label className="grid gap-1">
              Local browser profile
              <select
                className={inputClass}
                value={nativeChoice}
                disabled={pending}
                onChange={(event) => setNativeChoice(event.target.value)}
              >
                <option value="">Choose a profile</option>
                {nativeOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.source.label} / {option.profile.label}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <Button
                variant="outline"
                disabled={pending || !native || !name.trim()}
                onClick={() =>
                  operate(async () => {
                    if (!native) throw new Error("Choose a local profile");
                    await rpc.call("saveNativeProfile", {
                      name: name.trim(),
                      hostId,
                      family: native.source.family,
                      sourceProfileId: native.profile.id,
                    });
                    await refreshProfiles();
                    if (mounted.current) setName("");
                    return "Native profile saved. Its current cookies are read only when you apply it.";
                  })
                }
              >
                Save native profile
              </Button>
            </div>
          </>
        ) : null}
      </section>

      <section
        className="border-t border-border pt-5"
        aria-labelledby="browser-profile-saved"
      >
        <h3 id="browser-profile-saved" className="font-medium">
          Saved profiles
        </h3>
        {profiles.length ? (
          <ul>
            {profiles.map((profile) => (
              <SavedProfileRow
                key={profile.id}
                profile={profile}
                disabled={pending}
                defaults={defaults}
                onRename={(id, nextName) =>
                  operate(async () => {
                    await rpc.call("renameProfile", {
                      id,
                      name: nextName,
                    });
                    await refreshProfiles();
                    return "Profile renamed";
                  })
                }
                onRemove={(item) => {
                  if (
                    window.confirm(
                      `Delete saved profile “${item.name}”? Its saved JSON cookies and default label are removed. Cookies already applied to browsers are NOT cleared.`,
                    )
                  )
                    operate(async () => {
                      await rpc.call("removeProfile", {
                        id: item.id,
                        confirm: true,
                      });
                      await refreshProfiles();
                      return "Saved profile deleted; existing browser sessions were preserved";
                    });
                }}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-muted-foreground">
            No saved profiles yet. Name a profile, then save a native profile or
            a JSON export above.
          </p>
        )}
      </section>

      <section
        className="grid gap-3 border-t border-border pt-5"
        aria-labelledby="browser-profile-apply"
      >
        <h3 id="browser-profile-apply" className="font-medium">
          Apply a profile
        </h3>
        <p className="text-muted-foreground">
          Open an ordinary Browser tab in a thread once to initialize the shared
          session. Scan finds open native browser tabs across threads and
          windows on the chosen host.
        </p>
        <div>
          <Button
            variant="outline"
            disabled={pending || !hostId}
            onClick={() =>
              operate(async () => {
                const next = await rpc.call("findBrowsers", { hostId });
                if (mounted.current) {
                  setBrowsers(next);
                  setBrowserChoice((current) =>
                    next.some((browser) => targetKey(browser) === current)
                      ? current
                      : next.length === 1
                        ? targetKey(next[0])
                        : "",
                  );
                  setConfirmShared(false);
                }
                return next.length
                  ? `Found ${next.length} open Browser ${next.length === 1 ? "tab" : "tabs"}`
                  : "No open Browser tabs found. Open a browser in a thread, then scan again.";
              })
            }
          >
            Scan open browsers
          </Button>
        </div>
        <label className="grid gap-1">
          Target browser
          <select
            className={inputClass}
            value={browserChoice}
            disabled={pending || !browsers.length}
            onChange={(event) => {
              setBrowserChoice(event.target.value);
              setConfirmShared(false);
            }}
          >
            <option value="">Choose an open browser</option>
            {browsers.map((browser) => (
              <option key={targetKey(browser)} value={targetKey(browser)}>
                {browser.threadTitle} ·{" "}
                {browser.title || browser.url || "Blank tab"} ·{" "}
                {browser.windowLabel} ·{" "}
                {browser.profile === "personal" ? "shared" : "isolated"}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          Saved cookie profile
          <select
            className={inputClass}
            value={profileChoice}
            disabled={pending || !compatible.length}
            onChange={(event) => {
              setProfileChoice(event.target.value);
              setConfirmShared(false);
            }}
          >
            <option value="">Choose a saved profile</option>
            {compatible.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
        {selectedBrowser ? (
          <p className="break-words text-xs text-muted-foreground">
            {selectedBrowser.url || "Blank browser"} · {selectedBrowser.tabId}
            {selectedBrowser.controlLabel
              ? ` · Controlled by ${selectedBrowser.controlLabel}`
              : ""}
          </p>
        ) : null}
        {shared ? (
          <label className="flex items-start gap-2 rounded border border-border bg-surface-recessed p-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirmShared}
              disabled={pending}
              onChange={(event) => setConfirmShared(event.target.checked)}
            />
            <span>
              I understand this replaces every cookie in the shared BB Browser
              session, affecting existing and future ordinary tabs on this host.
              This becomes their shared default.
            </span>
          </label>
        ) : selectedBrowser ? (
          <p className="text-muted-foreground">
            This isolated browser will switch cookie profiles and reload. The
            shared default will not change.
          </p>
        ) : null}
        <div>
          <Button
            disabled={
              pending ||
              !selectedBrowser ||
              !selectedProfile ||
              !!selectedBrowser.controlLabel ||
              (shared && !confirmShared)
            }
            onClick={() =>
              operate(async () => {
                if (!selectedProfile)
                  throw new Error("Choose a saved cookie profile");
                const result = await rpc.call("applyProfile", {
                  ...selectedTarget(),
                  profileId: selectedProfile.id,
                  confirmShared,
                });
                await refreshProfiles();
                return `${result.importedCookies} cookies applied${
                  result.sharedDefault
                    ? "; shared default saved for existing and future ordinary tabs"
                    : " to the isolated browser"
                }.${result.reloaded ? " Browser reloaded." : " Reload the browser manually; its control may have changed."}`;
              })
            }
          >
            {shared ? "Apply shared default" : "Switch selected browser"}
          </Button>
        </div>
      </section>
      {pending ? (
        <p role="status" className="text-muted-foreground">
          Working… Browser scans can take a moment.
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-foreground">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "session-import",
    title: "Browser profiles",
    description: "Save and apply browser cookie session profiles",
    component: BrowserProfileSettings,
  });
});
