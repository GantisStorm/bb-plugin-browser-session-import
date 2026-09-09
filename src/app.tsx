import { useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type PluginSettingsSectionProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "./vendor/components/ui/button";
import { parseBrowserCookieImport } from "./browser-cookie-import.js";
import type { rpcContract, CookieSource, CurrentImport } from "./contracts.js";

type Status = {
  hostId: string | null;
  hostName: string | null;
  current: CurrentImport | null;
};

function BrowserSessionSettings(_: PluginSettingsSectionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<Status | null>(null);
  const [sources, setSources] = useState<CookieSource[]>([]);
  const [choice, setChoice] = useState("");
  const [pending, setPending] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const options = sources.flatMap((source) =>
    source.profiles.map((profile) => ({
      source,
      profile,
      key: JSON.stringify([source.family, profile.id]),
    })),
  );
  const selected = options.find((option) => option.key === choice);
  const requireHost = () => {
    if (!status?.hostId)
      throw new Error("No connected Browser host is available.");
    return status.hostId;
  };

  const refresh = async () => {
    const next = await rpc.call("current", {});
    if (mounted.current) setStatus(next);
  };
  useEffect(() => {
    mounted.current = true;
    void rpc
      .call("current", {})
      .then((next) => {
        if (mounted.current) setStatus(next);
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

  const operate = (work: () => Promise<string>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage(null);
    setError(null);
    void work()
      .then((text) => {
        if (mounted.current) setMessage(text);
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
  const current = status?.current ?? null;
  return (
    <div className="grid gap-4 text-sm text-foreground" aria-busy={pending}>
      <p className="text-muted-foreground">
        Import one browser session, and BB&apos;s shared Browser session uses it
        — every ordinary Browser tab, now and in the future. Isolated automation
        browsers keep their own session. Imports cookies only, not extensions,
        passwords, bookmarks, or local storage.
      </p>
      {status?.hostName ? (
        <p className="text-muted-foreground">
          Applies on host:{" "}
          <strong className="text-foreground">{status.hostName}</strong>
        </p>
      ) : null}
      {current ? (
        <p className="rounded border border-border bg-surface-recessed p-3">
          Currently imported:{" "}
          <strong className="text-foreground">
            {current.kind === "profile"
              ? `${current.sourceLabel} / ${current.profileLabel}`
              : current.fileName}
          </strong>
          {" · "}
          {current.importedCookies}{" "}
          {current.importedCookies === 1 ? "cookie" : "cookies"} ·{" "}
          {new Date(current.importedAt).toLocaleString()}
        </p>
      ) : (
        <p className="text-muted-foreground">No session imported yet.</p>
      )}

      <section className="grid gap-2 border-t border-border pt-4">
        <h3 className="font-medium">Import</h3>
        <p className="text-muted-foreground">
          A new import replaces the current session. Open an ordinary Browser
          tab in a thread first, then import.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={pending || !status?.hostId}
            onClick={() =>
              operate(async () => {
                const hostId = requireHost();
                const next = await rpc.call("listSources", { hostId });
                setSources(next);
                setChoice("");
                return next.length
                  ? "Choose a local profile below"
                  : "No local browser profiles found. Import a JSON cookie export instead.";
              })
            }
          >
            Find local browser profiles
          </Button>
          <Button
            variant="outline"
            disabled={pending || !status?.hostId}
            onClick={() => fileInput.current?.click()}
          >
            Import JSON cookie file
          </Button>
          <Button
            variant="outline"
            disabled={pending || !current}
            onClick={() => {
              if (
                window.confirm(
                  "Remove the imported session? This clears ALL cookies from the shared BB Browser session on this host.",
                )
              )
                operate(async () => {
                  const hostId = requireHost();
                  const result = await rpc.call("clear", {
                    hostId,
                    confirm: true,
                  });
                  await refresh();
                  return `Removed imported session (${result.clearedCookies} cookies cleared).`;
                });
            }}
          >
            Remove imported session
          </Button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="JSON cookie export file"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            operate(async () => {
              const hostId = requireHost();
              if (file.size > 16 * 1024 * 1024)
                throw new Error(
                  "Choose a JSON cookie export smaller than 16 MB",
                );
              const result = await rpc.call("importCookies", {
                hostId,
                fileName: file.name,
                cookies: parseBrowserCookieImport(
                  JSON.parse(await file.text()),
                ),
              });
              await refresh();
              return `Imported ${result.importedCookies} cookies into the shared Browser session.`;
            });
          }}
        />
        {options.length ? (
          <div className="grid gap-2">
            <label className="grid gap-1">
              Local browser profile
              <select
                className="min-h-11 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={choice}
                disabled={pending}
                onChange={(event) => setChoice(event.target.value)}
              >
                <option value="">Choose a profile</option>
                {options.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.source.label} / {option.profile.label}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <Button
                disabled={pending || !selected}
                onClick={() =>
                  operate(async () => {
                    if (!selected)
                      throw new Error("Choose a local browser profile");
                    const hostId = requireHost();
                    const result = await rpc.call("importProfile", {
                      hostId,
                      family: selected.source.family,
                      profileId: selected.profile.id,
                    });
                    await refresh();
                    return `Imported ${result.importedCookies} cookies from ${selected.source.label} / ${selected.profile.label} into the shared Browser session.`;
                  })
                }
              >
                Import into all Browsers
              </Button>
            </div>
          </div>
        ) : null}
      </section>
      {pending ? (
        <p role="status" className="text-muted-foreground">
          Working…
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
    title: "Browser Session Import",
    description: "Import one session into the shared BB Browser",
    component: BrowserSessionSettings,
  });
});
