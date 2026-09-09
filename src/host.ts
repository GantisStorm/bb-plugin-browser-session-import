import { execFileSync } from "node:child_process";
import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { z } from "zod";
import { hostContract, type Cookie } from "./contracts.js";

type Definition = {
  family: string;
  label: string;
  macRoot?: string;
  linuxRoot?: string;
  macService: string;
  macAccount: string;
  linuxApplication?: string;
};
type Profile = { id: string; label: string };
type Source = { definition: Definition; profile: Profile };
const chromium: readonly Definition[] = [
  {
    family: "chrome",
    label: "Google Chrome",
    macRoot: "Google/Chrome",
    linuxRoot: "google-chrome",
    macService: "Chrome Safe Storage",
    macAccount: "Chrome",
    linuxApplication: "chrome",
  },
  {
    family: "edge",
    label: "Microsoft Edge",
    macRoot: "Microsoft Edge",
    linuxRoot: "microsoft-edge",
    macService: "Microsoft Edge Safe Storage",
    macAccount: "Microsoft Edge",
    linuxApplication: "chromium",
  },
  {
    family: "arc",
    label: "Arc",
    macRoot: "Arc/User Data",
    macService: "Arc Safe Storage",
    macAccount: "Arc",
  },
  {
    family: "brave",
    label: "Brave",
    macRoot: "BraveSoftware/Brave-Browser",
    linuxRoot: "BraveSoftware/Brave-Browser",
    macService: "Brave Safe Storage",
    macAccount: "Brave",
    linuxApplication: "brave",
  },
  {
    family: "comet",
    label: "Comet",
    macRoot: "Comet",
    macService: "Comet Safe Storage",
    macAccount: "Comet",
  },
  {
    family: "helium",
    label: "Helium",
    macRoot: "net.imput.helium",
    macService: "Helium Storage Key",
    macAccount: "Helium",
  },
];
const chromiumRow = z.object({
  host_key: z.string(),
  name: z.string(),
  value: z.string(),
  path: z.string(),
  expiration_unix: z.number(),
  is_secure: z.number(),
  is_httponly: z.number(),
  samesite: z.number(),
  encrypted_value: z.instanceof(Uint8Array),
});
const firefoxRow = z.object({
  host: z.string(),
  name: z.string(),
  value: z.string(),
  path: z.string(),
  expiry: z.number(),
  isSecure: z.number(),
  isHttpOnly: z.number(),
  sameSite: z.number(),
});

function safeProfileId(value: string): boolean {
  return (
    value.length > 0 &&
    value !== "." &&
    !value.includes("\0") &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("..")
  );
}
function root(definition: Definition): string | null {
  const home = process.env.HOME ?? "";
  if (process.platform === "darwin")
    return definition.macRoot === undefined
      ? null
      : join(home, "Library", "Application Support", definition.macRoot);
  if (process.platform === "linux")
    return definition.linuxRoot === undefined
      ? null
      : join(
          process.env.XDG_CONFIG_HOME ?? join(home, ".config"),
          definition.linuxRoot,
        );
  return null;
}
function cookiePath(profile: string): string | null {
  for (const candidate of [
    join(profile, "Network", "Cookies"),
    join(profile, "Cookies"),
  ])
    if (existsSync(candidate)) return candidate;
  return null;
}
function chromiumProfiles(browserRoot: string): readonly Profile[] {
  try {
    const raw: unknown = JSON.parse(
      readFileSync(join(browserRoot, "Local State"), "utf8"),
    );
    const cache = z
      .object({
        profile: z
          .object({
            info_cache: z.record(
              z.string(),
              z.object({ name: z.string().optional() }),
            ),
          })
          .optional(),
      })
      .safeParse(raw).data?.profile?.info_cache;
    if (cache !== undefined) {
      const profiles = Object.entries(cache)
        .filter(([id]) => safeProfileId(id))
        .map(([id, detail]) => ({ id, label: detail.name ?? id }));
      if (profiles.length > 0) return profiles;
    }
  } catch {}
  return [{ id: "Default", label: "Default" }];
}
function firefoxRoot(): string | null {
  const home = process.env.HOME ?? "";
  if (process.platform === "darwin")
    return join(home, "Library", "Application Support", "Firefox", "Profiles");
  return process.platform === "linux"
    ? join(home, ".mozilla", "firefox")
    : null;
}
function allSources(): readonly Source[] {
  const found: Source[] = [];
  for (const definition of chromium) {
    const browserRoot = root(definition);
    if (browserRoot !== null)
      for (const profile of chromiumProfiles(browserRoot))
        if (cookiePath(join(browserRoot, profile.id)) !== null)
          found.push({ definition, profile });
  }
  const firefox = firefoxRoot();
  if (firefox !== null && existsSync(firefox)) {
    try {
      for (const entry of readdirSync(firefox, { withFileTypes: true }))
        if (
          entry.isDirectory() &&
          safeProfileId(entry.name) &&
          existsSync(join(firefox, entry.name, "cookies.sqlite"))
        )
          found.push({
            definition: {
              family: "firefox",
              label: "Firefox",
              macService: "",
              macAccount: "",
            },
            profile: {
              id: entry.name,
              label: entry.name.split(".").slice(1).join(".") || entry.name,
            },
          });
    } catch {}
  }
  return found;
}
function sources() {
  const grouped = new Map<
    string,
    { family: string; label: string; profiles: Profile[] }
  >();
  for (const source of allSources()) {
    const current = grouped.get(source.definition.family);
    if (current === undefined)
      grouped.set(source.definition.family, {
        family: source.definition.family,
        label: source.definition.label,
        profiles: [source.profile],
      });
    else current.profiles.push(source.profile);
  }
  return [...grouped.values()];
}
function snapshot(path: string) {
  const directory = mkdtempSync(join(tmpdir(), "bb-browser-cookies-"));
  try {
    const target = join(directory, "cookies.sqlite");
    copyFileSync(path, target);
    for (const suffix of ["-shm", "-wal"]) {
      if (existsSync(`${path}${suffix}`)) {
        copyFileSync(`${path}${suffix}`, `${target}${suffix}`);
      }
    }
    return { directory, path: target };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
type KeySet = { v10: Buffer[]; v11: Buffer[] };
function keys(definition: Definition): KeySet | null {
  if (process.platform === "darwin") {
    try {
      const secret = execFileSync(
        "security",
        [
          "find-generic-password",
          "-w",
          "-s",
          definition.macService,
          "-a",
          definition.macAccount,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      return {
        v10: [pbkdf2Sync(secret, "saltysalt", 1003, 16, "sha1")],
        v11: [],
      };
    } catch {
      return null;
    }
  }
  if (process.platform !== "linux") return null;
  let secret: string | null = null;
  if (definition.linuxApplication !== undefined)
    for (const args of [
      [
        "lookup",
        "xdg:schema",
        "chrome_libsecret_os_crypt_password_v2",
        "application",
        definition.linuxApplication,
      ],
      [
        "lookup",
        "xdg:schema",
        "chrome_libsecret_os_crypt_password_v1",
        "application",
        definition.linuxApplication,
      ],
    ])
      try {
        secret =
          execFileSync("secret-tool", args, {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 5000,
          }).trim() || null;
        if (secret !== null) break;
      } catch {}
  return {
    v10: [pbkdf2Sync("peanuts", "saltysalt", 1, 16, "sha1")],
    v11: [
      ...(secret === null
        ? []
        : [pbkdf2Sync(secret, "saltysalt", 1, 16, "sha1")]),
      pbkdf2Sync("", "saltysalt", 1, 16, "sha1"),
    ],
  };
}
function decrypt(
  value: Buffer,
  domain: string,
  hasDomainHash: boolean,
  available: KeySet | null,
): string | null {
  if (value.length === 0) return "";
  const version = value.subarray(0, 3).toString("utf8");
  if (version !== "v10" && version !== "v11") return null;
  for (const key of available?.[version] ?? [])
    try {
      const decipher = createDecipheriv(
        "aes-128-cbc",
        key,
        Buffer.alloc(16, 0x20),
      );
      let plain = Buffer.concat([
        decipher.update(value.subarray(3)),
        decipher.final(),
      ]);
      if (hasDomainHash) {
        const hash = createHash("sha256").update(domain).digest();
        if (
          plain.length < hash.length ||
          !plain.subarray(0, hash.length).equals(hash)
        )
          continue;
        plain = plain.subarray(hash.length);
      }
      return plain.toString("utf8");
    } catch {}
  return null;
}
function normalize(args: {
  domain: string;
  name: string;
  value: string | null;
  path: string;
  expirationDate: number | null;
  secure: boolean;
  httpOnly: boolean;
  sameSite: number;
}): Cookie | null {
  if (
    args.value === null ||
    args.domain.length === 0 ||
    args.name.length === 0 ||
    args.path.length === 0
  )
    return null;
  return {
    domain: args.domain,
    name: args.name,
    value: args.value,
    path: args.path,
    expirationDate: args.expirationDate,
    secure: args.secure,
    httpOnly: args.httpOnly,
    sameSite:
      args.sameSite === 0
        ? "no_restriction"
        : args.sameSite === 1
          ? "lax"
          : args.sameSite === 2
            ? "strict"
            : "unspecified",
  };
}
function profileCookies(source: Source): Cookie[] {
  const firefox = source.definition.family === "firefox";
  const profileRoot = firefox ? firefoxRoot() : root(source.definition);
  const sourcePath = firefox
    ? profileRoot === null
      ? null
      : join(profileRoot, source.profile.id, "cookies.sqlite")
    : profileRoot === null
      ? null
      : cookiePath(join(profileRoot, source.profile.id));
  if (sourcePath === null || !existsSync(sourcePath))
    throw new Error("Browser profile is not available on this host");
  const copied = snapshot(sourcePath);
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(copied.path, { readOnly: true });
    const raw = firefox
      ? database
          .prepare(
            "SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies",
          )
          .all()
      : database
          .prepare(
            "SELECT host_key, name, value, path, CAST(expires_utc / 1000000 - 11644473600 AS INTEGER) AS expiration_unix, is_secure, is_httponly, samesite, encrypted_value FROM cookies",
          )
          .all();
    const now = Math.floor(Date.now() / 1000);
    const out: Cookie[] = [];
    if (firefox)
      for (const row of firefoxRow.array().parse(raw)) {
        if (row.expiry > 0 && row.expiry <= now) continue;
        const cookie = normalize({
          domain: row.host,
          name: row.name,
          value: row.value,
          path: row.path,
          expirationDate: row.expiry > 0 ? Math.floor(row.expiry) : null,
          secure: row.isSecure === 1,
          httpOnly: row.isHttpOnly === 1,
          sameSite: row.sameSite,
        });
        if (cookie !== null) out.push(cookie);
      }
    else {
      const rows = chromiumRow.array().parse(raw);
      const version = z
        .object({ value: z.union([z.number(), z.string()]) })
        .safeParse(
          database
            .prepare("SELECT value FROM meta WHERE key = 'version'")
            .get(),
        );
      const hashed = version.success && Number(version.data.value) >= 24;
      const available = rows.some(
        (row) => row.value.length === 0 && row.encrypted_value.length > 0,
      )
        ? keys(source.definition)
        : null;
      for (const row of rows) {
        if (row.expiration_unix > 0 && row.expiration_unix <= now) continue;
        const encrypted =
          row.value.length === 0 && row.encrypted_value.length > 0;
        const value =
          row.value.length > 0
            ? row.value
            : encrypted
              ? decrypt(
                  Buffer.from(row.encrypted_value),
                  row.host_key,
                  hashed,
                  available,
                )
              : "";
        if (value === null) {
          throw new Error(
            "Could not decrypt the selected Chromium profile. Unlock its keychain entry and retry.",
          );
        }
        const cookie = normalize({
          domain: row.host_key,
          name: row.name,
          value,
          path: row.path,
          expirationDate: row.expiration_unix > 0 ? row.expiration_unix : null,
          secure: row.is_secure === 1,
          httpOnly: row.is_httponly === 1,
          sameSite: row.samesite,
        });
        if (cookie !== null) out.push(cookie);
      }
    }
    if (out.length === 0) {
      throw new Error("Selected browser profile has no importable cookies");
    }
    return out;
  } catch (error) {
    throw new Error(
      `Could not read selected browser cookies: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    database?.close();
    rmSync(copied.directory, { recursive: true, force: true });
  }
}
type PendingRequest = {
  reject(reason?: unknown): void;
  resolve(value: unknown): void;
  timeout: NodeJS.Timeout;
};
type CdpConnection = {
  close(): void;
  request(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<unknown>;
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
}

async function connect(
  wsEndpoint: string,
  signal: AbortSignal,
): Promise<CdpConnection> {
  signal.throwIfAborted();
  const socket = new WebSocket(wsEndpoint);
  const pending = new Map<number, PendingRequest>();
  const opened = deferred<void>();
  const timeout = setTimeout(() => {
    socket.close();
    opened.reject(new Error("Timed out connecting to selected Browser tab"));
  }, 30_000);
  let nextId = 1;
  socket.addEventListener("open", () => {
    clearTimeout(timeout);
    opened.resolve();
  });
  socket.addEventListener("message", ({ data }) => {
    try {
      const message: unknown = JSON.parse(String(data));
      if (
        typeof message !== "object" ||
        message === null ||
        !("id" in message) ||
        typeof message.id !== "number"
      ) {
        return;
      }
      const request = pending.get(message.id);
      if (request === undefined) return;
      clearTimeout(request.timeout);
      pending.delete(message.id);
      if ("error" in message && message.error !== undefined) {
        const detail =
          typeof message.error === "object" &&
          message.error !== null &&
          "message" in message.error &&
          typeof message.error.message === "string"
            ? message.error.message
            : "CDP request failed";
        request.reject(new Error(detail));
      } else {
        request.resolve(
          "result" in message && message.result !== undefined
            ? message.result
            : {},
        );
      }
    } catch (error) {
      for (const request of pending.values()) {
        clearTimeout(request.timeout);
        request.reject(error);
      }
      pending.clear();
    }
  });
  socket.addEventListener("error", () => {
    opened.reject(new Error("Could not connect to selected Browser tab"));
  });
  socket.addEventListener("close", () => {
    opened.reject(new Error("Browser connection closed"));
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error("Browser connection closed"));
    }
    pending.clear();
  });
  signal.addEventListener("abort", () => socket.close(), { once: true });
  await opened.promise;
  return {
    close() {
      socket.close();
      for (const request of pending.values()) {
        clearTimeout(request.timeout);
        request.reject(new Error("Browser connection closed"));
      }
      pending.clear();
    },
    request(method, params = {}, sessionId) {
      signal.throwIfAborted();
      const id = nextId++;
      const deferredRequest = deferred<unknown>();
      const timeout = setTimeout(() => {
        if (pending.delete(id)) {
          deferredRequest.reject(
            new Error(`Timed out waiting for CDP ${method}`),
          );
        }
      }, 30_000);
      pending.set(id, { ...deferredRequest, timeout });
      socket.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId === undefined ? {} : { sessionId }),
        }),
      );
      return deferredRequest.promise;
    },
  };
}

async function withPage<T>(
  wsEndpoint: string,
  _tabId: string,
  signal: AbortSignal,
  run: (connection: CdpConnection, sessionId: string) => Promise<T>,
): Promise<T> {
  const connection = await connect(wsEndpoint, signal);
  let sessionId: string | null = null;
  try {
    const targets = await connection.request("Target.getTargets");
    const pages = z
      .object({
        targetInfos: z.array(
          z.object({
            targetId: z.string(),
            type: z.string(),
          }),
        ),
      })
      .parse(targets)
      .targetInfos.filter((candidate) => candidate.type === "page");
    if (pages.length !== 1) {
      throw new Error("Selected Browser tab is no longer available");
    }
    const attached = z.object({ sessionId: z.string() }).parse(
      await connection.request("Target.attachToTarget", {
        targetId: pages[0].targetId,
        flatten: true,
      }),
    );
    sessionId = attached.sessionId;
    return await run(connection, sessionId);
  } finally {
    if (sessionId !== null) {
      await connection
        .request("Target.detachFromTarget", { sessionId })
        .catch(() => undefined);
    }
    connection.close();
  }
}

async function writeCookies(
  wsEndpoint: string,
  tabId: string,
  cookies: readonly Cookie[],
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  return withPage(wsEndpoint, tabId, signal, async (connection, sessionId) => {
    const previous = z
      .object({ cookies: z.array(z.record(z.string(), z.unknown())) })
      .parse(
        await connection.request("Network.getAllCookies", {}, sessionId),
      ).cookies;
    try {
      await connection.request("Network.clearBrowserCookies", {}, sessionId);
      for (const cookie of cookies) {
        signal.throwIfAborted();
        const result = await connection.request(
          "Network.setCookie",
          {
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite:
              cookie.sameSite === "no_restriction"
                ? "None"
                : cookie.sameSite === "lax"
                  ? "Lax"
                  : cookie.sameSite === "strict"
                    ? "Strict"
                    : undefined,
            expires: cookie.expirationDate ?? undefined,
          },
          sessionId,
        );
        if (
          typeof result !== "object" ||
          result === null ||
          !("success" in result) ||
          result.success !== true
        ) {
          throw new Error(`Browser rejected cookie ${cookie.name}`);
        }
      }
      return { importedCookies: cookies.length };
    } catch (error) {
      try {
        await connection.request("Network.clearBrowserCookies", {}, sessionId);
        await connection.request(
          "Network.setCookies",
          { cookies: previous },
          sessionId,
        );
      } catch {
        throw new Error(
          "Cookie switching failed and the previous browser cookies could not be restored. Reapply a saved profile before continuing.",
        );
      }
      throw new Error(
        `Cookie switching failed; the previous cookies were restored: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    listSources: () => sources(),
    reload: ({ tabId, wsEndpoint }, context) =>
      withPage(
        wsEndpoint,
        tabId,
        context.signal,
        async (connection, sessionId) => {
          await connection.request("Page.reload", {}, sessionId);
          return { ok: true as const };
        },
      ),
    importProfile: async (
      { family, profileId, tabId, wsEndpoint },
      context,
    ) => {
      const source = allSources().find(
        (candidate) =>
          candidate.definition.family === family &&
          candidate.profile.id === profileId,
      );
      if (source === undefined) {
        throw new Error("Browser profile is unavailable; list sources again");
      }
      return writeCookies(
        wsEndpoint,
        tabId,
        profileCookies(source),
        context.signal,
      );
    },
    importCookies: ({ cookies, tabId, wsEndpoint }, context) =>
      writeCookies(wsEndpoint, tabId, cookies, context.signal),
  },
});
