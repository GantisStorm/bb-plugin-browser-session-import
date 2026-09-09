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
  type Cookie,
  type Request,
} from "./contracts.js";
import { createProfileManager } from "./profiles.js";

const toolName = "bb_browser_session_import";

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
type BrowserTarget = {
  hostId: string;
  instanceId: string;
  generation: string;
  threadId: string;
  tabId: string;
};

function scopeFor(target: BrowserTarget) {
  return {
    hostId: target.hostId,
    instanceId: target.instanceId,
    generation: target.generation,
    threadId: target.threadId,
  };
}

export default function browserSessionImport(bb: BbPluginApi): void {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const desktop = bb.sdk.experimental_desktopBrowsers;
  const active = new Set<string>();
  const runScoped = async <T>(
    target: BrowserTarget,
    destination: string,
    work: (wsEndpoint: string) => Promise<T>,
  ): Promise<T> => {
    const key = destination;
    if (active.has(key))
      throw new Error(
        "A browser session import is already pending for this destination profile",
      );
    active.add(key);
    let leaseId: string | null = null;
    try {
      const lease = await desktop.acquireControl({
        ...scopeFor(target),
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
      return await work(connection.wsEndpoint);
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
  const destinationFor = async (target: BrowserTarget) => {
    const { tabs } = await desktop.listTabs(scopeFor(target));
    const tab = tabs.find((candidate) => candidate.tabId === target.tabId);
    if (tab === undefined)
      throw new Error("Selected Browser tab is no longer available");
    return tab.profile.kind === "personal"
      ? `${target.hostId}/personal`
      : `${target.hostId}/automation/${tab.profile.id}`;
  };
  async function importProfileInto(input: {
    hostId: string;
    instanceId: string;
    generation: string;
    threadId: string;
    tabId: string;
    family: string;
    profileId: string;
  }) {
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
    const destination = await destinationFor(input);
    const result = await runScoped(input, destination, async (wsEndpoint) =>
      host.call(
        "importProfile",
        {
          family: input.family,
          profileId: input.profileId,
          tabId: input.tabId,
          wsEndpoint,
        },
        { hostId: input.hostId },
      ),
    );
    if (destination.endsWith("/personal"))
      profiles.forgetDestination(destination);
    return result;
  }
  async function importCookiesInto(input: {
    hostId: string;
    instanceId: string;
    generation: string;
    threadId: string;
    tabId: string;
    fileName: string;
    cookies: Cookie[];
  }) {
    const destination = await destinationFor(input);
    const result = await runScoped(input, destination, async (wsEndpoint) =>
      host.call(
        "importCookies",
        { cookies: input.cookies, tabId: input.tabId, wsEndpoint },
        { hostId: input.hostId },
      ),
    );
    if (destination.endsWith("/personal"))
      profiles.forgetDestination(destination);
    return result;
  }
  const profiles = createProfileManager(bb, {
    listSources: (input) =>
      host.call("listSources", {}, { hostId: input.hostId }),
    importProfile: importProfileInto,
    importCookies: importCookiesInto,
    reload: async (target) => {
      const destination = await destinationFor(target);
      await runScoped(target, destination, async (wsEndpoint) => {
        await host.call(
          "reload",
          { tabId: target.tabId, wsEndpoint },
          { hostId: target.hostId },
        );
      });
    },
  });
  const handlers: PluginRpcHandlers<typeof rpcContract> = {
    ...profiles.handlers,
    async listHosts() {
      return (await bb.sdk.hosts.list()).map((host) => ({
        id: host.id,
        name: host.name,
        status: host.status,
      }));
    },
    async listInstances({ hostId }) {
      const { instances } = await desktop.listInstances({ hostId });
      return instances.map((instance) => ({
        hostId: instance.hostId,
        instanceId: instance.instanceId,
        generation: instance.generation,
        label: instance.label,
      }));
    },
    async listTabs(scope) {
      const { tabs } = await desktop.listTabs(scope);
      return tabs.map((tab) => ({
        tabId: tab.tabId,
        title: tab.title,
        url: tab.url,
        profile: tab.profile.kind,
        profileId: tab.profile.kind === "automation" ? tab.profile.id : null,
        controlLabel: tab.control?.controllerLabel ?? null,
      }));
    },
    async listSources({ hostId }) {
      return host.call("listSources", {}, { hostId });
    },
    importProfile: importProfileInto,
    importCookies: importCookiesInto,
  };
  bb.rpc.register(rpcContract, handlers);
  const execute = async (request: Request) => {
    switch (request.operation) {
      case "list-hosts":
        return handlers.listHosts({});
      case "list-instances":
        return handlers.listInstances(request);
      case "list-tabs":
        return handlers.listTabs(request.target);
      case "list-sources":
        return handlers.listSources(request);
      case "import-profile":
        return handlers.importProfile(request);
      case "import-cookies":
        return handlers.importCookies(request);
      case "profiles":
        return handlers.profiles({});
      case "save-native-profile": {
        const { operation, ...input } = request;
        return handlers.saveNativeProfile(input);
      }
      case "save-json-profile": {
        const { operation, ...input } = request;
        return handlers.saveJsonProfile(input);
      }
      case "rename-profile": {
        const { operation, ...input } = request;
        return handlers.renameProfile(input);
      }
      case "remove-profile": {
        const { operation, ...input } = request;
        return handlers.removeProfile(input);
      }
      case "find-browsers": {
        const { operation, ...input } = request;
        return handlers.findBrowsers(input);
      }
      case "apply-profile": {
        const { operation, ...input } = request;
        return handlers.applyProfile(input);
      }
    }
  };
  bb.agents.registerTool({
    name: toolName,
    description:
      "Import a native browser profile or supplied normalized cookies into an explicitly selected BB Browser tab, or apply one saved cookie profile. This does not provide general browser automation. List instances, tabs, and sources before importing.",
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
    summary: "Save and apply browser cookie session profiles",
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
