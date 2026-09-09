import { randomUUID } from "node:crypto";
import { chmodSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import {
  cookieSchema,
  savedProfileSchema,
  sharedDefaultSchema,
  type rpcContract,
  type SavedProfile,
  type DiscoveredBrowser,
  type targetSchema,
} from "./contracts.js";

type Target = z.infer<typeof targetSchema>;
type Handlers = PluginRpcHandlers<typeof rpcContract>;
type ProfileHandlers = Pick<
  Handlers,
  | "profiles"
  | "saveNativeProfile"
  | "saveJsonProfile"
  | "renameProfile"
  | "removeProfile"
  | "findBrowsers"
  | "applyProfile"
>;
const metadataRow = z.object({ metadata_json: z.string() });
const cookiesRow = z.object({ cookies_json: z.string().nullable() });

export function createProfileManager(
  bb: BbPluginApi,
  operations: Pick<
    Handlers,
    "listSources" | "importProfile" | "importCookies"
  > & { reload(target: Target): Promise<void> },
) {
  const database = bb.storage.database();
  bb.storage.migrate(database, [
    "CREATE TABLE browser_saved_profiles (id TEXT PRIMARY KEY, metadata_json TEXT NOT NULL, cookies_json TEXT)",
    "CREATE TABLE browser_profile_defaults (host_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, applied_at INTEGER NOT NULL)",
  ]);
  chmodSync(dirname(database.name), 0o700);
  for (const suffix of ["", "-wal", "-shm"])
    if (existsSync(database.name + suffix))
      chmodSync(database.name + suffix, 0o600);
  const lifetime = new AbortController();
  bb.onDispose(() => lifetime.abort());
  let writes = Promise.resolve();
  const mutate = <T>(work: () => Promise<T> | T): Promise<T> => {
    const next = writes.then(() => {
      lifetime.signal.throwIfAborted();
      return work();
    });
    writes = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  const get = (id: string) => {
    const row = database
      .prepare("SELECT metadata_json FROM browser_saved_profiles WHERE id = ?")
      .get(id);
    if (!row)
      throw new Error("Saved profile no longer exists; refresh settings");
    return savedProfileSchema.parse(
      JSON.parse(metadataRow.parse(row).metadata_json),
    );
  };
  const save = (profile: SavedProfile, cookies: string | null) => {
    const count = z
      .object({ count: z.number() })
      .parse(
        database
          .prepare("SELECT count(*) AS count FROM browser_saved_profiles")
          .get(),
      ).count;
    if (count >= 100)
      throw new Error(
        "Remove an unused profile before saving more than 100 profiles",
      );
    database
      .prepare(
        "INSERT INTO browser_saved_profiles (id, metadata_json, cookies_json) VALUES (?, ?, ?)",
      )
      .run(profile.id, JSON.stringify(profile), cookies);
    return profile;
  };
  const forgetDestination = (destination: string) => {
    if (destination.endsWith("/personal"))
      database
        .prepare("DELETE FROM browser_profile_defaults WHERE host_id = ?")
        .run(destination.slice(0, -"/personal".length));
  };

  const findBrowsers: Handlers["findBrowsers"] = async ({ hostId }) => {
    const desktop = bb.sdk.experimental_desktopBrowsers;
    const { instances } = await desktop.listInstances({ hostId });
    if (!instances.length) return [];
    const threads = new Map<string, string>();
    for (const archived of [false, true]) {
      for (let offset = 0; ; offset += 200) {
        lifetime.signal.throwIfAborted();
        const page = await bb.sdk.threads.list({
          archived,
          includeHidden: true,
          limit: 200,
          offset,
          signal: lifetime.signal,
        });
        for (const thread of page)
          threads.set(
            thread.id,
            thread.title ?? thread.titleFallback ?? thread.id,
          );
        if (page.length < 200) break;
      }
    }
    const entries = [...threads];
    const output: DiscoveredBrowser[] = [];
    let next = 0;
    const count = entries.length * instances.length;
    await Promise.all(
      Array.from({ length: Math.min(6, count) }, async () => {
        while (next < count) {
          lifetime.signal.throwIfAborted();
          const index = next++;
          const instance = instances[Math.floor(index / entries.length)];
          const [threadId, threadTitle] = entries[index % entries.length];
          const scope = {
            hostId,
            instanceId: instance.instanceId,
            generation: instance.generation,
            threadId,
          };
          const { tabs } = await desktop.listTabs(scope);
          for (const tab of tabs)
            output.push({
              ...scope,
              tabId: tab.tabId,
              title: tab.title,
              url: tab.url,
              threadTitle,
              windowLabel: instance.label,
              profile: tab.profile.kind,
              profileId:
                tab.profile.kind === "automation" ? tab.profile.id : null,
              controlLabel: tab.control?.controllerLabel ?? null,
            });
        }
      }),
    );
    return output.sort(
      (left, right) =>
        left.threadTitle.localeCompare(right.threadTitle) ||
        left.title.localeCompare(right.title),
    );
  };

  const handlers: ProfileHandlers = {
    profiles: async () => {
      await writes;
      return {
        profiles: database
          .prepare(
            "SELECT metadata_json FROM browser_saved_profiles ORDER BY rowid",
          )
          .all()
          .map((row) =>
            savedProfileSchema.parse(
              JSON.parse(metadataRow.parse(row).metadata_json),
            ),
          ),
        defaults: z
          .array(sharedDefaultSchema)
          .parse(
            database
              .prepare(
                "SELECT host_id AS hostId, profile_id AS profileId, applied_at AS appliedAt FROM browser_profile_defaults ORDER BY host_id",
              )
              .all(),
          ),
      };
    },
    saveNativeProfile: (input) =>
      mutate(async () => {
        const sources = await operations.listSources({ hostId: input.hostId });
        const source = sources.find(
          (candidate) => candidate.family === input.family,
        );
        const profile = source?.profiles.find(
          (candidate) => candidate.id === input.sourceProfileId,
        );
        if (!source || !profile)
          throw new Error(
            "Native profile is unavailable; find local profiles again",
          );
        return save(
          {
            id: randomUUID(),
            name: input.name,
            createdAt: Date.now(),
            kind: "native",
            hostId: input.hostId,
            family: input.family,
            sourceProfileId: profile.id,
            sourceLabel: source.label,
            profileLabel: profile.label,
          },
          null,
        );
      }),
    saveJsonProfile: (input) =>
      mutate(() => {
        const encoded = JSON.stringify(input.cookies);
        if (Buffer.byteLength(encoded) > 16 * 1024 * 1024)
          throw new Error("Cookie profiles must be smaller than 16 MB");
        return save(
          {
            id: randomUUID(),
            name: input.name,
            createdAt: Date.now(),
            kind: "json",
            fileName: input.fileName,
            cookieCount: input.cookies.length,
          },
          encoded,
        );
      }),
    renameProfile: (input) =>
      mutate(() => {
        const profile = { ...get(input.id), name: input.name };
        database
          .prepare(
            "UPDATE browser_saved_profiles SET metadata_json = ? WHERE id = ?",
          )
          .run(JSON.stringify(profile), input.id);
        return profile;
      }),
    removeProfile: (input) =>
      mutate(() => {
        get(input.id);
        database.transaction(() => {
          database
            .prepare(
              "DELETE FROM browser_profile_defaults WHERE profile_id = ?",
            )
            .run(input.id);
          database
            .prepare("DELETE FROM browser_saved_profiles WHERE id = ?")
            .run(input.id);
        })();
        return { ok: true as const };
      }),
    findBrowsers,
    applyProfile: (input) =>
      mutate(async () => {
        const profile = get(input.profileId);
        const target = {
          hostId: input.hostId,
          instanceId: input.instanceId,
          generation: input.generation,
          threadId: input.threadId,
          tabId: input.tabId,
        };
        const { tabs } = await bb.sdk.experimental_desktopBrowsers.listTabs({
          hostId: target.hostId,
          instanceId: target.instanceId,
          generation: target.generation,
          threadId: target.threadId,
        });
        const selected = tabs.find((tab) => tab.tabId === target.tabId);
        if (!selected)
          throw new Error("Browser target is stale; refresh open browsers");
        const shared = selected.profile.kind === "personal";
        if (shared && !input.confirmShared)
          throw new Error(
            "Confirm that all existing and future shared Browser tabs will use this cookie profile",
          );
        if (profile.kind === "native" && profile.hostId !== target.hostId)
          throw new Error(
            "This native profile belongs to another host; use a profile from the selected host or a JSON profile",
          );
        const destinations = await findBrowsers({ hostId: target.hostId });
        const selectedProfileId =
          selected.profile.kind === "automation" ? selected.profile.id : null;
        if (
          destinations.some(
            (tab) =>
              tab.controlLabel !== null &&
              (shared
                ? tab.profile === "personal"
                : tab.profileId === selectedProfileId),
          )
        )
          throw new Error(
            "A browser sharing this session is controlled by automation. Release that control before switching profiles",
          );
        lifetime.signal.throwIfAborted();
        const entry =
          profile.kind === "native"
            ? await operations.importProfile({
                ...target,
                family: profile.family,
                profileId: profile.sourceProfileId,
              })
            : await operations.importCookies({
                ...target,
                fileName: profile.fileName,
                cookies: (() => {
                  const stored = cookiesRow.parse(
                    database
                      .prepare(
                        "SELECT cookies_json FROM browser_saved_profiles WHERE id = ?",
                      )
                      .get(profile.id),
                  );
                  if (stored.cookies_json === null)
                    throw new Error("The saved profile has no cookie payload");
                  const cookies = z
                    .array(cookieSchema)
                    .parse(JSON.parse(stored.cookies_json))
                    .filter(
                      (cookie) =>
                        cookie.expirationDate === null ||
                        cookie.expirationDate > Date.now() / 1000,
                    );
                  if (!cookies.length)
                    throw new Error(
                      "All cookies in this profile have expired; save an updated JSON export",
                    );
                  return cookies;
                })(),
              });
        if (shared)
          database
            .prepare(
              "INSERT INTO browser_profile_defaults (host_id, profile_id, applied_at) VALUES (?, ?, ?) ON CONFLICT(host_id) DO UPDATE SET profile_id = excluded.profile_id, applied_at = excluded.applied_at",
            )
            .run(target.hostId, profile.id, Date.now());
        let reloaded = true;
        try {
          await operations.reload(target);
        } catch (error) {
          reloaded = false;
          bb.log.warn(
            `Cookies applied; reload the selected Browser manually: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        return {
          importedCookies: entry.importedCookies,
          sharedDefault: shared,
          reloaded,
        };
      }),
  };
  return { handlers, forgetDestination };
}
