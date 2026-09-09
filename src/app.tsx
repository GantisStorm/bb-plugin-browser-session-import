import { useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  type PluginSettingsSectionProps,
  type PluginThreadPanelProps,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import { Button } from "./vendor/components/ui/button";
import { BrowserCookieImportWizard } from "./BrowserCookieImportWizard";
import { parseBrowserCookieImport } from "./browser-cookie-import.js";
import { rpcContract, type CookieSource, type ImportRecord } from "./contracts.js";

type Target = {
  hostId: string;
  instanceId: string;
  generation: string;
  threadId: string;
  tabId: string;
};
type Host = { id: string; name: string; status: "connected" | "disconnected" };
type Instance = { hostId: string; instanceId: string; generation: string; label: string };
type Tab = {
  tabId: string;
  title: string;
  url: string;
  profile: "personal" | "automation";
  profileId: string | null;
  controlLabel: string | null;
};

function SessionImportPanel({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [target, setTarget] = useState<Target>({
    hostId: "",
    instanceId: "",
    generation: "",
    threadId,
    tabId: "",
  });
  const [hosts, setHosts] = useState<Host[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [sources, setSources] = useState<CookieSource[] | null>(null);
  const [history, setHistory] = useState<ImportRecord[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"error" | "success" | null>(null);
  const [busy, setBusy] = useState<"import" | "clear" | null>(null);
  const discovery = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const selectedTab = tabs.find((tab) => tab.tabId === target.tabId) ?? null;
  const ready = target.hostId.length > 0 && target.instanceId.length > 0 && target.generation.length > 0 && target.tabId.length > 0;
  const scopeReady =
    target.hostId.length > 0 &&
    target.instanceId.length > 0 &&
    target.generation.length > 0;
  const report = (error: unknown) => {
    setTone("error");
    setMessage(error instanceof Error ? error.message : String(error));
  };
  const refreshHistory = async () => setHistory(await rpc.call("history", {}));
  const destination =
    selectedTab === null
      ? null
      : selectedTab.profile === "personal"
        ? `${target.hostId}/personal`
        : `${target.hostId}/automation/${selectedTab.profileId}`;
  useEffect(() => {
    void Promise.all([rpc.call("listHosts", {}), refreshHistory()]).then(
      ([nextHosts]) => setHosts(nextHosts),
      report,
    );
  }, []);
  useEffect(() => {
    if (destination === null) {
      setHistory([]);
      return;
    }
    void rpc.call("history", { destination }).then(setHistory, report);
  }, [destination]);
  const selectHost = (hostId: string) => {
    if (busy !== null) return;
    const ticket = ++discovery.current;
    setTarget({ hostId, instanceId: "", generation: "", threadId, tabId: "" });
    setInstances([]);
    setTabs([]);
    setSources(null);
    if (hostId.length === 0) return;
    void rpc.call("listInstances", { hostId }).then(
      (result) => {
        if (ticket === discovery.current) setInstances(result);
      },
      (error) => {
        if (ticket === discovery.current) report(error);
      },
    );
  };
  const selectInstance = (instanceId: string) => {
    if (busy !== null) return;
    const instance = instances.find(
      (candidate) => candidate.instanceId === instanceId,
    );
    if (instance === undefined) return;
    const ticket = ++discovery.current;
    const scope = {
      hostId: instance.hostId,
      instanceId: instance.instanceId,
      generation: instance.generation,
      threadId,
    };
    setTarget({ ...scope, tabId: "" });
    setTabs([]);
    void rpc.call("listTabs", scope).then(
      (result) => {
        if (ticket === discovery.current) setTabs(result);
      },
      (error) => {
        if (ticket === discovery.current) report(error);
      },
    );
  };
  const loadSources = () => {
    if (target.hostId.length === 0) {
      report(new Error("Select the Browser host before discovering profiles"));
      return;
    }
    const hostId = target.hostId;
    const ticket = ++discovery.current;
    void rpc.call("listSources", { hostId }).then(
      (result) => {
        if (ticket === discovery.current) setSources(result);
      },
      (error) => {
        if (ticket === discovery.current) report(error);
      },
    );
  };
  const operate = async (
    kind: "import" | "clear",
    operation: () => Promise<ImportRecord | { clearedCookies: number }>,
  ) => {
    if (!ready) {
      report(new Error("Select an exact Browser tab before writing cookies"));
      return;
    }
    setBusy(kind);
    setMessage(null);
    setTone(null);
    try {
      const result = await operation();
      if ("kind" in result) {
        setHistory((current) => [result, ...current].slice(0, 100));
        setMessage(
          `Imported ${result.importedCookies} ${result.importedCookies === 1 ? "cookie" : "cookies"}`,
        );
      } else {
        setHistory([]);
        setMessage(
          `Cleared ${result.clearedCookies} ${result.clearedCookies === 1 ? "cookie" : "cookies"}`,
        );
      }
      setTone("success");
    } catch (error) {
      report(error);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border p-4">
        <h2 className="text-sm font-medium">Browser session import</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Select the exact Browser target. Writes use a temporary lease and reject contention.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <label className="text-xs text-muted-foreground">Host<select value={target.hostId} onChange={(event) => selectHost(event.target.value)} className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground"><option value="">Select host</option>{hosts.map((host) => <option key={host.id} value={host.id} disabled={host.status !== "connected"}>{host.name} · {host.status}</option>)}</select></label>
          <label className="text-xs text-muted-foreground">Browser window<select value={target.instanceId} disabled={busy !== null || target.hostId.length === 0} onChange={(event) => selectInstance(event.target.value)} className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground"><option value="">Select window</option>{instances.map((instance) => <option key={instance.instanceId} value={instance.instanceId}>{instance.label}</option>)}</select></label>
          <label className="text-xs text-muted-foreground">Browser tab<select value={target.tabId} disabled={busy !== null || target.instanceId.length === 0} onChange={(event) => { if (busy === null) setTarget((current) => ({ ...current, tabId: event.target.value })); }} className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground"><option value="">Select tab</option>{tabs.map((tab) => <option key={tab.tabId} value={tab.tabId}>{tab.title || tab.url}</option>)}</select></label>
        </div>
        {selectedTab === null ? null : <p className="mt-2 text-xs text-muted-foreground">Selected profile: {selectedTab.profile === "personal" ? "personal shared profile — imported cookies are shared with the user’s Browser" : "isolated automation profile"}.{selectedTab.controlLabel === null ? "" : ` Controlled by ${selectedTab.controlLabel}.`}</p>}
        <div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={loadSources} disabled={busy !== null || target.hostId.length === 0}>Find local profiles</Button><Button type="button" variant="outline" size="sm" disabled={busy !== null || !scopeReady} onClick={() => void rpc.call("openHomepage", { hostId: target.hostId, instanceId: target.instanceId, generation: target.generation, threadId }).then(() => { setTone("success"); setMessage("Opened homepage in the selected Browser window"); }, report)}>Open homepage</Button></div>
      </div>
      <input ref={input} className="sr-only" type="file" accept="application/json,.json" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file === undefined) return; void operate("import", async () => rpc.call("importCookies", { ...target, fileName: file.name, cookies: parseBrowserCookieImport(JSON.parse(await file.text())) })); }} />
      <BrowserCookieImportWizard currentImport={history[0] ?? null} isClearing={busy === "clear"} isImporting={busy === "import"} isLoadingSources={false} message={message} messageTone={tone} sourceError={null} sources={sources} onClose={() => setSources(null)} onImportFromFile={() => input.current?.click()} onImportFromBrowser={(family, profileId) => void operate("import", () => rpc.call("importProfile", { ...target, family, profileId }))} onClear={() => { if (selectedTab === null) { report(new Error("Select a Browser tab before clearing cookies")); return; } const profile = selectedTab.profile === "personal" ? "the shared personal Browser profile" : "the isolated automation profile"; if (window.confirm(`Clear all imported cookies from ${profile}?`)) void operate("clear", () => rpc.call("clear", { ...target, confirm: true })); }} />
    </div>
  );
}

function SettingsSection(_: PluginSettingsSectionProps) {
  const settings = useSettings();
  return <p className="text-sm text-muted-foreground">Open homepage uses {typeof settings.values?.homepageUrl === "string" ? settings.values.homepageUrl : "the configured Browser homepage URL"}. Change it in this plugin’s settings above.</p>;
}

function ThreadPanel({ threadId }: PluginThreadPanelProps) {
  return <SessionImportPanel threadId={threadId} />;
}

export default definePluginApp((app) => {
  app.slots.settingsSection({ id: "session-import", title: "Browser Session Import", description: "Local profile and JSON cookie import", component: SettingsSection });
  app.slots.threadPanelAction({ id: "session-import", title: "Import browser session", icon: "File", layout: "flush", component: ThreadPanel });
});
