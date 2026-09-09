import type {
  BbPluginApi,
  PluginAgentToolResult,
  PluginRpcHandlers,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  hostContract,
  requestSchema,
  rpcContract,
  currentImportSchema,
  type Cookie,
  type Request,
} from "./contracts.js";

const toolName = "bb_browser_session_import";
const currentKey = "current";

function failure(error: unknown): PluginAgentToolResult {
  return {
    content: [
      {
        type: "text",
        text: error instanceof Error ? error.message : String(error),
      },
    ],
    isError: true,
  };
}
type SharedTarget = {
  hostId: string;
  instanceId: string;
  generation: string;
  threadId: string;
  tabId: string;
};

export default function browserSessionImport(bb: BbPluginApi): void {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const desktop = bb.sdk.experimental_desktopBrowsers;
  const active = new Set<string>();

  const connectedHost = async () => {
    const hosts = await bb.sdk.hosts.list();
    const connected = hosts.find(
      (candidate) => candidate.status === "connected",
    );
    if (!connected) throw new Error("No connected Browser host is available.");
    return connected;
  };
  const sharedTab = async (hostId: string): Promise<SharedTarget> => {
    const { instances } = await desktop.listInstances({ hostId });
    const threads = new Map<string, string>();
    for (const archived of [false, true]) {
      for (let offset = 0; ; offset += 200) {
        const page = await bb.sdk.threads.list({
          archived,
          includeHidden: true,
          limit: 200,
          offset,
        });
        for (const thread of page) {
          if (!threads.has(thread.id))
            threads.set(
              thread.id,
              thread.title ?? thread.titleFallback ?? thread.id,
            );
        }
        if (page.length < 200) break;
      }
    }
    for (const instance of instances) {
      for (const threadId of threads.keys()) {
        const scope = {
          hostId,
          instanceId: instance.instanceId,
          generation: instance.generation,
          threadId,
        };
        const { tabs } = await desktop.listTabs(scope);
        const shared = tabs.find(
          (tab) => tab.profile.kind === "personal" && tab.control === null,
        );
        if (shared) return { ...scope, tabId: shared.tabId };
      }
    }
    throw new Error(
      "Open an ordinary Browser tab in a thread first, then import again. The import applies to that shared session.",
    );
  };
  const withSharedTab = async <R>(
    hostId: string,
    action: (target: SharedTarget, wsEndpoint: string) => Promise<R>,
  ): Promise<R> => {
    const key = `${hostId}/personal`;
    if (active.has(key))
      throw new Error("A browser session import is already in progress");
    const target = await sharedTab(hostId);
    active.add(key);
    let leaseId: string | null = null;
    try {
      const lease = await desktop.acquireControl({
        hostId: target.hostId,
        instanceId: target.instanceId,
        generation: target.generation,
        threadId: target.threadId,
        tabIds: [target.tabId],
        controllerLabel: "Browser Session Import",
        ttlMs: 120_000,
        allowPersonal: true,
      });
      leaseId = lease.leaseId;
      const connection = await desktop.openConnection({
        hostId: target.hostId,
        instanceId: target.instanceId,
        generation: target.generation,
        threadId: target.threadId,
        leaseId,
      });
      return await action(target, connection.wsEndpoint);
    } finally {
      if (leaseId !== null) {
        await desktop
          .releaseControl({
            hostId: target.hostId,
            instanceId: target.instanceId,
            generation: target.generation,
            threadId: target.threadId,
            leaseId,
          })
          .catch((error: unknown) =>
            bb.log.warn(
              `Could not release Browser import lease: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
      }
      active.delete(key);
    }
  };
  const reloadSharedTab = (
    target: SharedTarget,
    wsEndpoint: string,
    hostId: string,
  ) => host.call("reload", { tabId: target.tabId, wsEndpoint }, { hostId });
  const storeCurrent = async (current: unknown) => {
    await bb.storage.kv.set(currentKey, currentImportSchema.parse(current));
  };
  const readCurrent = async () => {
    const value = await bb.storage.kv.get<unknown>(currentKey);
    const parsed = currentImportSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  };
  const importProfile = async (input: {
    hostId: string;
    family: string;
    profileId: string;
  }) => {
    const sources = await host.call(
      "listSources",
      {},
      { hostId: input.hostId },
    );
    const source = sources.find(
      (candidate) => candidate.family === input.family,
    );
    const profile = source?.profiles.find(
      (candidate) => candidate.id === input.profileId,
    );
    if (source === undefined || profile === undefined) {
      throw new Error("Browser profile is unavailable; list sources again");
    }
    const result = await withSharedTab(input.hostId, async (target, ws) => {
      const imported = await host.call(
        "importProfile",
        {
          family: input.family,
          profileId: input.profileId,
          tabId: target.tabId,
          wsEndpoint: ws,
        },
        { hostId: input.hostId },
      );
      await reloadSharedTab(target, ws, input.hostId);
      await storeCurrent({
        kind: "profile",
        sourceLabel: source.label,
        profileLabel: profile.label,
        importedCookies: imported.importedCookies,
        importedAt: Date.now(),
      });
      return imported.importedCookies;
    });
    return { importedCookies: result, hostId: input.hostId };
  };
  const importCookies = async (input: {
    hostId: string;
    fileName: string;
    cookies: Cookie[];
  }) => {
    const result = await withSharedTab(input.hostId, async (target, ws) => {
      const imported = await host.call(
        "importCookies",
        { cookies: input.cookies, tabId: target.tabId, wsEndpoint: ws },
        { hostId: input.hostId },
      );
      await reloadSharedTab(target, ws, input.hostId);
      await storeCurrent({
        kind: "json",
        fileName: input.fileName,
        importedCookies: imported.importedCookies,
        importedAt: Date.now(),
      });
      return imported.importedCookies;
    });
    return { importedCookies: result, hostId: input.hostId };
  };
  const clear = async (input: { hostId: string; confirm: true }) => {
    const cleared = await withSharedTab(input.hostId, async (target, ws) => {
      const result = await host.call(
        "clear",
        { tabId: target.tabId, wsEndpoint: ws },
        { hostId: input.hostId },
      );
      await reloadSharedTab(target, ws, input.hostId);
      await bb.storage.kv.delete(currentKey);
      return result.clearedCookies;
    });
    return { clearedCookies: cleared };
  };
  const handlers: PluginRpcHandlers<typeof rpcContract> = {
    async listSources({ hostId }) {
      return host.call("listSources", {}, { hostId });
    },
    importProfile,
    importCookies,
    clear,
    async current() {
      const connected = await connectedHost();
      return {
        hostId: connected.id,
        hostName: connected.name,
        current: await readCurrent(),
      };
    },
  };
  bb.rpc.register(rpcContract, handlers);
  const execute = async (request: Request) => {
    switch (request.operation) {
      case "list-sources":
        return handlers.listSources(request);
      case "import-profile":
        return handlers.importProfile(request);
      case "import-cookies":
        return handlers.importCookies(request);
      case "clear":
        return handlers.clear(request);
      case "current":
        return handlers.current({});
    }
  };
  bb.agents.registerTool({
    name: toolName,
    description:
      "Import a native browser profile or normalized cookies into the shared BB Browser session so every ordinary Browser tab uses that session. This does not provide general browser automation. List sources before importing a native profile. Clear requires confirm:true.",
    parameters: z.toJSONSchema(requestSchema, { io: "input" }),
    async execute(input) {
      try {
        return JSON.stringify(await execute(requestSchema.parse(input)));
      } catch (error) {
        return failure(error);
      }
    },
  });
  bb.cli.register({
    name: "browser-session-import",
    summary: "Import or clear the shared BB Browser session",
    commands: [
      {
        name: "run",
        summary: "Run one session import operation",
        usage: "bb browser-session-import '<json>'",
      },
    ],
    async run(argv) {
      try {
        if (argv.length !== 1)
          throw new Error("Usage: bb browser-session-import '<json>'");
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            await execute(requestSchema.parse(JSON.parse(argv[0]!))),
            null,
            2,
          ),
        };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
  bb.agents.configure(() => ({
    tools: [toolName],
    skills: ["browser-session-import"],
  }));
}
