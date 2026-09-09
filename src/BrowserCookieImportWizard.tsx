import { useState } from "react";
import { Button } from "./vendor/components/ui/button";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "./vendor/components/ui/coarse-pointer-sizing";
import { Icon } from "./vendor/components/ui/icon";
import { cn } from "./vendor/lib/utils";
import type { CookieSource, ImportRecord } from "./contracts.js";

interface BrowserCookieImportSelection {
  family: string;
  profileId: string;
  profileLabel: string;
  sourceLabel: string;
}

interface BrowserCookieImportWizardProps {
  currentImport: ImportRecord | null;
  isClearing: boolean;
  isImporting: boolean;
  isLoadingSources: boolean;
  message: string | null;
  sourceError: string | null;
  messageTone: "error" | "success" | null;
  onClear: () => void;
  onClose: () => void;
  onImportFromBrowser: (family: string, profileId: string) => void;
  onImportFromFile: () => void;
  sources: readonly CookieSource[] | null;
}

export function BrowserCookieImportWizard({
  currentImport,
  isClearing,
  isImporting,
  isLoadingSources,
  message,
  sourceError,
  messageTone,
  onClear,
  onClose,
  onImportFromBrowser,
  onImportFromFile,
  sources,
}: BrowserCookieImportWizardProps) {
  const [selection, setSelection] =
    useState<BrowserCookieImportSelection | null>(null);
  const isBusy = isImporting || isClearing;
  const isReimport =
    selection !== null &&
    currentImport?.kind === "profile" &&
    selection.family === currentImport.family &&
    selection.profileId === currentImport.profileId;

  return (
    <section
      aria-label="Import browser session"
      className="absolute inset-0 z-30 flex min-h-0 flex-col bg-background text-foreground"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Import browser session</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Import replaces every cookie in the selected destination Browser
            profile. It can affect other tabs sharing that profile.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close import wizard"
          onClick={onClose}
          className={cn(
            COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
            "shrink-0 text-muted-foreground",
          )}
        >
          <Icon name="X" className="size-4" aria-hidden />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-8 sm:px-8">
          <div
            className="flex items-center gap-3"
            role="list"
            aria-label="Import progress"
          >
            <span
              role="listitem"
              aria-label="Choose source"
              aria-current={selection === null ? "step" : undefined}
              className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
            >
              1
            </span>
            <span className="h-px flex-1 bg-border" aria-hidden />
            <span
              role="listitem"
              aria-label="Review import"
              aria-current={selection === null ? undefined : "step"}
              className={
                selection === null
                  ? "flex size-7 items-center justify-center rounded-full border border-border text-xs font-semibold text-muted-foreground"
                  : "flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
              }
            >
              2
            </span>
          </div>

          {selection === null ? (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold tracking-tight">
                  Choose where to import from
                </h3>
                <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
                  bb discovers local browser profiles without uploading their
                  data. Only cookies needed for the current browsing session are
                  copied.
                </p>
              </div>

              {currentImport === null ? null : (
                <section
                  aria-label="Currently imported session"
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-state-hover">
                      <Icon
                        name="CircleCheck"
                        className="size-4 text-success"
                        aria-hidden
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        Currently imported
                      </p>
                      <p className="mt-0.5 truncate text-sm font-medium">
                        {currentImport.kind === "profile"
                          ? currentImport.sourceLabel
                          : currentImport.fileName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {currentImport.kind === "profile"
                          ? currentImport.profileLabel
                          : "Cookie JSON file"}
                        {" · "}
                        {currentImport.importedCookies}{" "}
                        {currentImport.importedCookies === 1
                          ? "cookie"
                          : "cookies"}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    Reimporting clears every cookie in this destination Browser
                    profile before copying the selected source session.
                  </p>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => {
                        if (currentImport.kind === "profile") {
                          setSelection({
                            family: currentImport.family,
                            profileId: currentImport.profileId,
                            profileLabel: currentImport.profileLabel,
                            sourceLabel: currentImport.sourceLabel,
                          });
                        } else {
                          onImportFromFile();
                        }
                      }}
                    >
                      {currentImport.kind === "profile"
                        ? "Reimport"
                        : "Choose file again"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isBusy}
                      onClick={onClear}
                      className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                    >
                      {isClearing ? "Clearing…" : "Clear destination cookies"}
                    </Button>
                  </div>
                </section>
              )}

              <div className="space-y-2">
                {isLoadingSources ? (
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
                    <Icon
                      name="Loading"
                      className="size-4 motion-safe:animate-spin"
                      aria-hidden
                    />
                    Finding browser profiles…
                  </div>
                ) : sourceError !== null ? (
                  <div
                    role="alert"
                    className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-4 text-sm text-destructive-text"
                  >
                    {sourceError}
                  </div>
                ) : sources === null ||
                  sources.every((source) => source.profiles.length === 0) ? (
                  <div className="rounded-xl border border-dashed border-border px-4 py-5">
                    <p className="text-sm font-medium">
                      No local profiles found
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      You can still import a JSON cookie export below.
                    </p>
                  </div>
                ) : (
                  sources.flatMap((source) =>
                    source.profiles.map((profile) => (
                      <button
                        key={`${source.family}:${profile.id}`}
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          setSelection({
                            family: source.family,
                            profileId: profile.id,
                            profileLabel: profile.label,
                            sourceLabel: source.label,
                          })
                        }
                        className="group flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-left transition-colors hover:border-ring/60 hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-state-hover text-foreground">
                          <Icon name="Globe" className="size-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">
                            {source.label}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {profile.label}
                          </span>
                        </span>
                        <Icon
                          name="ChevronRight"
                          className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                          aria-hidden
                        />
                      </button>
                    )),
                  )
                )}
              </div>

              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <button
                type="button"
                disabled={isBusy}
                onClick={onImportFromFile}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-background px-4 py-3.5 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-state-hover text-foreground">
                  <Icon name="File" className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    Import a cookie JSON file
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Use a standard JSON cookie export from another browser.
                  </span>
                </span>
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setSelection(null)}
                  className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                >
                  <Icon name="ChevronLeft" className="size-3.5" aria-hidden />
                  Choose another profile
                </button>
                <h3 className="text-lg font-semibold tracking-tight">
                  Review this import
                </h3>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Confirm the source. Import clears every cookie in the
                  selected destination Browser profile before copying this session.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-state-hover">
                    <Icon name="Globe" className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {selection.sourceLabel}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {selection.profileLabel}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background p-4">
                <div className="flex gap-3">
                  <Icon
                    name="CircleCheck"
                    className="mt-0.5 size-4 shrink-0 text-success"
                    aria-hidden
                  />
                  <div>
                    <p className="text-sm font-medium">Cookie session only</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Passwords, history, bookmarks, and autofill data stay in
                      the source browser. The destination profile’s existing
                      cookies are cleared before this source session is copied.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isBusy}
                  onClick={() => setSelection(null)}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  disabled={isBusy}
                  onClick={() =>
                    onImportFromBrowser(selection.family, selection.profileId)
                  }
                >
                  {isImporting
                    ? "Importing…"
                    : isReimport
                      ? "Reimport session"
                      : "Import session"}
                </Button>
              </div>
            </div>
          )}

          {message === null ? null : (
            <div
              role={messageTone === "error" ? "alert" : "status"}
              aria-live="polite"
              className={cn(
                "rounded-xl border border-border px-4 py-3 text-sm",
                messageTone === "error"
                  ? "bg-destructive/10"
                  : "bg-state-hover",
                messageTone === "error"
                  ? "text-destructive-text"
                  : messageTone === "success"
                    ? "text-foreground"
                    : "text-muted-foreground",
              )}
            >
              {message}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
