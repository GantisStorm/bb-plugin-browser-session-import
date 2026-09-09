import type { BbPluginApi, PluginAgentToolResult, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { hostContract, requestSchema, rpcContract, type ImportRecord, type Request } from "./contracts.js";
import { createProfileManager } from "./profiles.js";

const toolName = "bb_browser_session_import";
const historyKey = "history";

function failure(error: unknown): PluginAgentToolResult {
  return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
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
  const settings = bb.settings.define({
    homepageUrl: {
      type: "string",
      label: "Browser homepage URL",
      description: "URL opened by Browser Session Import's Open homepage action.",
      default: "https://www.google.com/",
      experimental_schema: z.url().refine((value) => {
        const url = new URL(value);
        return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
      }, "Use an HTTP(S) URL without credentials."),
    },
  });
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const desktop = bb.sdk.experimental_desktopBrowsers;
  const active = new Set<string>();
  const history = async (destination?: string): Promise<ImportRecord[]> => {
    const value = await bb.storage.kv.get<unknown>(historyKey);
    const parsed = z.array(rpcContract.history.output.element).max(100).safeParse(value);
    if (!parsed.success) return [];
    return destination === undefined
      ? parsed.data
      : parsed.data.filter((entry) => entry.destination === destination);
  };
  let historyWrite = Promise.resolve();
  const updateHistory = (update: (entries: ImportRecord[]) => ImportRecord[]) => {
    const next = historyWrite.then(async () => {
      await bb.storage.kv.set(historyKey, update(await history()));
    });
    historyWrite = next.catch(() => {});
    return next;
  };
  const record = async (entry: ImportRecord) => {
    profiles.forgetDestination(entry.destination);
    await updateHistory((entries) => [entry, ...entries].slice(0, 100));
    return entry;
  };
  const runScoped = async <T>(
    target: BrowserTarget,
    destination: string,
    work: (wsEndpoint: string) => Promise<T>,
  ): Promise<T> => {
    const key = destination;
    if (active.has(key)) throw new Error("A browser session import is already pending for this destination profile");
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
      const connection = await desktop.openConnection({ hostId: target.hostId, instanceId: target.instanceId, generation: target.generation, threadId: target.threadId, leaseId });
      return await work(connection.wsEndpoint);
    } finally {
      if (leaseId !== null) {
        await desktop.releaseControl({ hostId: target.hostId, instanceId: target.instanceId, generation: target.generation, threadId: target.threadId, leaseId }).catch((error: unknown) => bb.log.warn(`Could not release Browser import lease: ${error instanceof Error ? error.message : String(error)}`));
      }
      active.delete(key);
    }
  };
  const destinationFor = async (target: BrowserTarget) => {
    const { tabs } = await desktop.listTabs(scopeFor(target));
    const tab = tabs.find((candidate) => candidate.tabId === target.tabId);
    if (tab === undefined) throw new Error("Selected Browser tab is no longer available");
    return tab.profile.kind === "personal"
      ? `${target.hostId}/personal`
      : `${target.hostId}/automation/${tab.profile.id}`;
  };
  const profiles = createProfileManager(bb, {
    listSources: (input) => host.call("listSources", {}, { hostId: input.hostId }),
    importProfile: (input) => handlers.importProfile(input),
    importCookies: (input) => handlers.importCookies(input),
    reload: async (target) => {
      const destination = await destinationFor(target);
      await runScoped(target, destination, async (wsEndpoint) => {
        await host.call("reload", { tabId: target.tabId, wsEndpoint }, { hostId: target.hostId });
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
      return instances.map((instance) => ({ hostId: instance.hostId, instanceId: instance.instanceId, generation: instance.generation, label: instance.label }));
    },
    async listTabs(scope) {
      const { tabs } = await desktop.listTabs(scope);
      return tabs.map((tab) => ({ tabId: tab.tabId, title: tab.title, url: tab.url, profile: tab.profile.kind, profileId: tab.profile.kind === "automation" ? tab.profile.id : null, controlLabel: tab.control?.controllerLabel ?? null }));
    },
    async listSources({ hostId }) {
      return host.call("listSources", {}, { hostId });
    },
    async history({ destination }) {
      return history(destination);
    },
    async importProfile(input) {
      const sources = await host.call("listSources", {}, { hostId: input.hostId });
      const source = sources.find((candidate) => candidate.family === input.family);
      const profile = source?.profiles.find(
        (candidate) => candidate.id === input.profileId,
      );
      if (source === undefined || profile === undefined) {
        throw new Error("Browser profile is unavailable; list sources again");
      }
      const destination = await destinationFor(input);
      return runScoped(input, destination, async (wsEndpoint) => {
        const result = await host.call(
          "importProfile",
          {
            family: input.family,
            profileId: input.profileId,
            tabId: input.tabId,
            wsEndpoint,
          },
          { hostId: input.hostId },
        );
        return record({
          kind: "profile",
          destination,
          family: input.family,
          profileId: input.profileId,
          sourceLabel: source.label,
          profileLabel: profile.label,
          importedCookies: result.importedCookies,
          importedAt: Date.now(),
        });
      });
    },
    async importCookies(input) {
      const destination = await destinationFor(input);
      return runScoped(input, destination, async (wsEndpoint) => {
        const result = await host.call(
          "importCookies",
          { cookies: input.cookies, tabId: input.tabId, wsEndpoint },
          { hostId: input.hostId },
        );
        return record({
          kind: "json",
          destination,
          fileName: input.fileName,
          importedCookies: result.importedCookies,
          importedAt: Date.now(),
        });
      });
    },
    async clear(input) {
      const destination = await destinationFor(input);
      return runScoped(input, destination, async (wsEndpoint) => {
        const result = await host.call(
          "clear",
          { tabId: input.tabId, wsEndpoint },
          { hostId: input.hostId },
        );
        await updateHistory((entries) => entries.filter((entry) => entry.destination !== destination));
        profiles.forgetDestination(destination);
        return result;
      });
    },
    async openHomepage(scope) {
      const { homepageUrl } = await settings.get();
      const { defaults } = await profiles.handlers.profiles({});
      const selected = defaults.find((entry) => entry.hostId === scope.hostId);
      const created = await desktop.createTab({
        ...scope,
        url: selected ? "about:blank" : homepageUrl,
        presentation: selected ? "hidden" : "reveal",
      });
      const target = { ...scope, tabId: created.tab.tabId };
      try {
        if (selected) {
          await profiles.handlers.applyProfile({ ...target, profileId: selected.profileId, confirmShared: false });
          const destination = await destinationFor(target);
          await runScoped(target, destination, async (wsEndpoint) => {
            await host.call("navigate", { tabId: target.tabId, wsEndpoint, url: homepageUrl }, { hostId: target.hostId });
          });
          await desktop.revealTab(target);
        }
        return { tabId: target.tabId };
      } catch (error) {
        const { tabs } = await desktop.listTabs(scope);
        if (tabs.find((tab) => tab.tabId === target.tabId)?.control === null) await desktop.closeTab(target);
        throw error;
      }
    },
  };
  bb.rpc.register(rpcContract, handlers);
  const execute = async (request: Request) => {
    switch (request.operation) {
      case "list-hosts": return handlers.listHosts({});
      case "list-instances": return handlers.listInstances(request);
      case "list-tabs": return handlers.listTabs(request.target);
      case "list-sources": return handlers.listSources(request);
      case "history": return handlers.history({});
      case "import-profile": return handlers.importProfile({ ...request.target, family: request.family, profileId: request.profileId });
      case "import-cookies": return handlers.importCookies({ ...request.target, fileName: request.fileName, cookies: request.cookies });
      case "clear": return handlers.clear({ ...request.target, confirm: request.confirm });
      case "open-homepage": return handlers.openHomepage(request.target);
      case "profiles": return handlers.profiles({});
      case "save-native-profile": { const { operation, ...input } = request; return handlers.saveNativeProfile(input); }
      case "save-json-profile": { const { operation, ...input } = request; return handlers.saveJsonProfile(input); }
      case "rename-profile": { const { operation, ...input } = request; return handlers.renameProfile(input); }
      case "remove-profile": { const { operation, ...input } = request; return handlers.removeProfile(input); }
      case "find-browsers": { const { operation, ...input } = request; return handlers.findBrowsers(input); }
      case "apply-profile": { const { operation, ...input } = request; return handlers.applyProfile(input); }
    }
  };
  bb.agents.registerTool({
    name: toolName,
    description: "Import a native browser profile or supplied normalized cookies into an explicitly selected BB Browser tab. This does not provide general browser automation. List instances, tabs, and sources before importing. Clear requires confirm:true.",
    parameters: z.toJSONSchema(requestSchema, { io: "input" }),
    async execute(input) {
      try { return JSON.stringify(await execute(requestSchema.parse(input))); }
      catch (error) { return failure(error); }
    },
  });
  bb.cli.register({
    name: "browser-session-import",
    summary: "Manage saved cookie profiles, shared defaults, and browser session imports",
    commands: [{ name: "run", summary: "Run one session import operation", usage: "bb browser-session-import '<json>'" }],
    async run(argv) {
      try {
        if (argv.length !== 1) throw new Error("Usage: bb browser-session-import '<json>'");
        return { exitCode: 0, stdout: JSON.stringify(await execute(requestSchema.parse(JSON.parse(argv[0]!))), null, 2) };
      } catch (error) {
        return { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
      }
    },
  });
  bb.agents.configure(() => ({ tools: [toolName], skills: ["browser-session-import"] }));
}
